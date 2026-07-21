import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
  ShopifyConnectionStatus,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyApiService } from './shopify-api.service';

@Injectable()
export class ShopifyWebhookService {
  private readonly logger = new Logger(ShopifyWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyApi: ShopifyApiService,
  ) {}

  async handle(request: Request, rawBody: Buffer | undefined) {
    if (!rawBody?.length) {
      throw new BadRequestException('Shopify webhook raw body is required');
    }

    const rawBodyText = rawBody.toString('utf8');
    const webhook = await this.shopifyApi.validateWebhook(request, rawBodyText);
    try {
      JSON.parse(rawBodyText);
    } catch {
      throw new BadRequestException('Shopify webhook body must be valid JSON');
    }

    try {
      if (webhook.topic === 'SHOP_REDACT') {
        await this.prisma.$transaction([
          this.prisma.shopifyOAuthState.deleteMany({
            where: { shopDomain: webhook.domain },
          }),
          this.prisma.ecommerceConnection.deleteMany({
            where: {
              platform: EcommercePlatform.SHOPIFY,
              externalAccountId: webhook.domain,
            },
          }),
          this.prisma.shopifyConnection.deleteMany({
            where: { shopDomain: webhook.domain },
          }),
          this.prisma.shopifyWebhookReceipt.deleteMany({
            where: { shopDomain: webhook.domain },
          }),
        ]);
      } else {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.shopifyWebhookReceipt.create({
            data: {
              webhookId: webhook.webhookId,
              topic: webhook.topic,
              shopDomain: webhook.domain,
            },
          });

          if (webhook.topic === 'APP_UNINSTALLED') {
            const connections = await transaction.shopifyConnection.findMany({
              where: { shopDomain: webhook.domain },
              select: { ecommerceConnectionId: true },
            });
            await transaction.shopifyConnection.updateMany({
              where: { shopDomain: webhook.domain },
              data: {
                status: ShopifyConnectionStatus.DISCONNECTED,
                encryptedAccessToken: null,
                encryptedRefreshToken: null,
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
                disconnectedAt: new Date(),
              },
            });
            const ecommerceConnectionIds = connections
              .map((connection) => connection.ecommerceConnectionId)
              .filter((id): id is string => id !== null);
            if (ecommerceConnectionIds.length > 0) {
              await transaction.ecommerceConnection.updateMany({
                where: { id: { in: ecommerceConnectionIds } },
                data: { status: EcommerceConnectionStatus.DISCONNECTED },
              });
            }
          }

          // Synced revenue records contain order IDs and financial totals only,
          // with no customer identity. Customer privacy topics therefore have
          // no customer payload to export or erase. SHOP_REDACT removes the
          // connection and cascades all normalized revenue records.
        });
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          received: true,
          duplicate: true,
          topic: webhook.topic,
          webhookId: webhook.webhookId,
        };
      }
      throw error;
    }

    this.logger.log(
      `Processed Shopify webhook ${webhook.topic} (${webhook.webhookId})`,
    );
    return {
      received: true,
      duplicate: false,
      topic: webhook.topic,
      webhookId: webhook.webhookId,
    };
  }
}

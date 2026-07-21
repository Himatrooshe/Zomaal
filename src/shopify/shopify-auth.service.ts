import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
  ShopifyConnectionStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ShopifyConnectionStatusDto } from './dto/shopify-response.dto';
import { ShopifyApiService } from './shopify-api.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyTokenEncryptionService } from './shopify-token-encryption.service';
import {
  accessTokenContext,
  refreshTokenContext,
} from './shopify-token-context';

const REQUIRED_CALLBACK_FIELDS = [
  'code',
  'hmac',
  'shop',
  'state',
  'timestamp',
] as const;

@Injectable()
export class ShopifyAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly shopifyApi: ShopifyApiService,
    private readonly tokenEncryption: ShopifyTokenEncryptionService,
    private readonly connectionService: ShopifyConnectionService,
  ) {}

  async begin(userId: string, requestedShopDomain: string) {
    this.shopifyApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException(
        'Create your Zomaal store before connecting Shopify',
      );
    }

    const shopDomain = this.shopifyApi.normalizeShopDomain(requestedShopDomain);
    const linkedShop = await this.prisma.shopifyConnection.findUnique({
      where: { shopDomain },
      select: { storeId: true },
    });
    if (linkedShop && linkedShop.storeId !== store.id) {
      throw new ConflictException(
        'This Shopify store is already connected to another Zomaal store',
      );
    }

    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    const expiresAt = new Date(
      Date.now() +
        this.configService.get<number>('SHOPIFY_OAUTH_STATE_TTL_SECONDS', 600) *
          1000,
    );

    await this.prisma.$transaction([
      this.prisma.shopifyOAuthState.deleteMany({
        where: {
          OR: [{ expiresAt: { lte: new Date() } }, { storeId: store.id }],
        },
      }),
      this.prisma.shopifyOAuthState.create({
        data: {
          stateHash,
          shopDomain,
          expiresAt,
          userId,
          storeId: store.id,
        },
      }),
    ]);

    return {
      authorizationUrl: this.shopifyApi.buildAuthorizationUrl(
        shopDomain,
        state,
      ),
      shopDomain,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(
    rawQuery: Record<string, unknown>,
  ): Promise<ShopifyConnectionStatusDto> {
    const query = this.normalizeQuery(rawQuery);
    for (const field of REQUIRED_CALLBACK_FIELDS) {
      if (!query[field]) {
        throw new BadRequestException(
          `Shopify OAuth callback is missing ${field}`,
        );
      }
    }

    const shopDomain = this.shopifyApi.normalizeShopDomain(query.shop);
    await this.shopifyApi.validateOAuthQuery(query);

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.shopifyOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState) {
      throw new UnauthorizedException(
        'Shopify OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      await this.prisma.shopifyOAuthState.delete({
        where: { stateHash },
      });
      throw new UnauthorizedException('Shopify OAuth state has expired');
    }
    if (oauthState.shopDomain !== shopDomain) {
      throw new UnauthorizedException(
        'Shopify OAuth shop does not match the authorization request',
      );
    }

    await this.prisma.shopifyOAuthState.delete({ where: { stateHash } });
    const tokens = await this.shopifyApi.exchangeAuthorizationCode(
      shopDomain,
      query.code,
    );

    const existingShop = await this.prisma.shopifyConnection.findUnique({
      where: { shopDomain },
      select: { storeId: true },
    });
    if (existingShop && existingShop.storeId !== oauthState.storeId) {
      throw new ConflictException(
        'This Shopify store is already connected to another Zomaal store',
      );
    }

    const encryptedAccessToken = this.tokenEncryption.encrypt(
      tokens.accessToken,
      accessTokenContext(shopDomain),
    );
    const encryptedRefreshToken = this.tokenEncryption.encrypt(
      tokens.refreshToken,
      refreshTokenContext(shopDomain),
    );
    const installedAt = new Date();

    try {
      await this.prisma.$transaction(async (transaction) => {
        const existingConnection =
          await transaction.ecommerceConnection.findUnique({
            where: {
              storeId_platform: {
                storeId: oauthState.storeId,
                platform: EcommercePlatform.SHOPIFY,
              },
            },
          });
        const accountChanged =
          existingConnection !== null &&
          existingConnection.externalAccountId !== shopDomain;

        if (accountChanged) {
          await transaction.ecommerceOrder.deleteMany({
            where: { connectionId: existingConnection.id },
          });
        }

        const ecommerceConnection =
          await transaction.ecommerceConnection.upsert({
            where: {
              storeId_platform: {
                storeId: oauthState.storeId,
                platform: EcommercePlatform.SHOPIFY,
              },
            },
            create: {
              storeId: oauthState.storeId,
              platform: EcommercePlatform.SHOPIFY,
              externalAccountId: shopDomain,
              displayName: shopDomain,
              status: EcommerceConnectionStatus.ACTIVE,
            },
            update: {
              externalAccountId: shopDomain,
              displayName: shopDomain,
              status: EcommerceConnectionStatus.ACTIVE,
              ...(accountChanged
                ? {
                    syncCursor: null,
                    syncFrom: null,
                    syncStartedAt: null,
                    lastSyncedAt: null,
                    lastSyncError: null,
                  }
                : {}),
            },
          });

        await transaction.shopifyConnection.upsert({
          where: { storeId: oauthState.storeId },
          create: {
            storeId: oauthState.storeId,
            ecommerceConnectionId: ecommerceConnection.id,
            shopDomain,
            status: ShopifyConnectionStatus.ACTIVE,
            encryptedAccessToken,
            encryptedRefreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
            grantedScopes: tokens.grantedScopes,
            lastVerifiedAt: installedAt,
          },
          update: {
            ecommerceConnectionId: ecommerceConnection.id,
            shopDomain,
            status: ShopifyConnectionStatus.ACTIVE,
            encryptedAccessToken,
            encryptedRefreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
            grantedScopes: tokens.grantedScopes,
            installedAt,
            disconnectedAt: null,
            lastVerifiedAt: installedAt,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Shopify store is already connected to another Zomaal store',
        );
      }
      throw error;
    }

    return this.connectionService.getStatus(oauthState.userId);
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl('SHOPIFY_AUTH_SUCCESS_REDIRECT_URL', 'connected');
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('SHOPIFY_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  private normalizeQuery(
    rawQuery: Record<string, unknown>,
  ): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawQuery)) {
      if (typeof value === 'string') {
        query[key] = value;
      } else if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
      ) {
        query[key] = value.join(',');
      } else {
        throw new BadRequestException(
          `Invalid Shopify OAuth query parameter: ${key}`,
        );
      }
    }
    return query;
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) {
      return null;
    }
    const url = new URL(configured);
    url.searchParams.set('shopify', status);
    return url.toString();
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

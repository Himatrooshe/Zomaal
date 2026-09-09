import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  EcommerceOrderStatus,
  EcommercePlatform,
  Prisma,
  ShopifyConnectionStatus,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyApiService } from './shopify-api.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { CustomerRiskService } from '../customers/customer-risk.service';
import {
  normalizeShopifyOrder,
  type RawShopifyRevenueOrder,
  SHOPIFY_REVENUE_ORDER_FIELDS,
} from './shopify-order-projection';

const ORDER_UPSERT_TOPICS = new Set([
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'REFUNDS_CREATE',
]);
const PRODUCT_TOPICS = new Set([
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
]);
const CUSTOMER_TOPICS = new Set([
  'CUSTOMERS_CREATE',
  'CUSTOMERS_UPDATE',
  'CUSTOMERS_DELETE',
]);

const ORDER_QUERY = `#graphql
  query ZomaalWebhookOrder($id: ID!) {
    order(id: $id) {
      ${SHOPIFY_REVENUE_ORDER_FIELDS}
    }
  }
`;

const PRODUCT_COUNT_QUERY = `#graphql
  query ZomaalWebhookProductCount {
    productsCount(limit: null) { count }
  }
`;

const CUSTOMER_COUNT_QUERY = `#graphql
  query ZomaalWebhookCustomerCount {
    customersCount(limit: null) { count }
  }
`;

interface VerifiedWebhook {
  topic: string;
  domain: string;
  webhookId: string;
}

interface ConnectedShop {
  id: string;
  storeId: string;
  status: ShopifyConnectionStatus;
  ecommerceConnectionId: string | null;
}

@Injectable()
export class ShopifyWebhookService {
  private readonly logger = new Logger(ShopifyWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyApi: ShopifyApiService,
    private readonly connectionService: ShopifyConnectionService,
    private readonly customerRisk: CustomerRiskService,
  ) {}

  async handle(request: Request, rawBody: Buffer | undefined) {
    if (!rawBody?.length) {
      throw new BadRequestException('Shopify webhook raw body is required');
    }

    const rawBodyText = rawBody.toString('utf8');
    const webhook = await this.shopifyApi.validateWebhook(request, rawBodyText);
    const payload = parsePayload(rawBodyText);

    const existingReceipt = await this.prisma.shopifyWebhookReceipt.findUnique({
      where: { webhookId: webhook.webhookId },
      select: { webhookId: true },
    });
    if (existingReceipt) {
      return this.receiptResponse(webhook, true);
    }

    try {
      await this.process(webhook, payload);
    } catch (error) {
      await this.prisma.shopifyConnection.updateMany({
        where: { shopDomain: webhook.domain },
        data: { lastWebhookError: safeErrorMessage(error) },
      });
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.receiptResponse(webhook, true);
      }
      throw error;
    }

    this.logger.log(
      `Processed Shopify webhook ${webhook.topic} (${webhook.webhookId})`,
    );
    return this.receiptResponse(webhook, false);
  }

  private async process(
    webhook: VerifiedWebhook,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (webhook.topic === 'SHOP_REDACT') {
      await this.processShopRedact(webhook.domain);
      return;
    }
    if (webhook.topic === 'CUSTOMERS_REDACT') {
      // Must be honored even for a disconnected/reauthorization-required
      // shop — handled before the ACTIVE-connection gate below.
      await this.processCustomerRedact(webhook, payload);
      return;
    }
    if (webhook.topic === 'CUSTOMERS_DATA_REQUEST') {
      // Shopify's docs treat actually disclosing the data to the customer
      // as a merchant/support responsibility, not something the webhook
      // response itself must return synchronously. No PII is deleted here;
      // this just acknowledges receipt so the webhook doesn't retry.
      this.logger.log(
        `Shopify customer data request received for shop ${webhook.domain}`,
      );
      await this.recordReceipt(webhook, null);
      return;
    }

    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { shopDomain: webhook.domain },
      select: {
        id: true,
        storeId: true,
        status: true,
        ecommerceConnectionId: true,
      },
    });

    if (webhook.topic === 'APP_UNINSTALLED') {
      await this.processUninstall(webhook);
      return;
    }

    if (
      !connection ||
      connection.status !== ShopifyConnectionStatus.ACTIVE ||
      !connection.ecommerceConnectionId
    ) {
      await this.recordReceipt(webhook, connection?.id ?? null);
      return;
    }
    const activeConnection: ConnectedShop & { ecommerceConnectionId: string } =
      {
        ...connection,
        ecommerceConnectionId: connection.ecommerceConnectionId,
      };

    if (webhook.topic === 'ORDERS_DELETE') {
      await this.deleteOrder(webhook, payload, activeConnection);
      return;
    }
    if (ORDER_UPSERT_TOPICS.has(webhook.topic)) {
      await this.upsertCurrentOrder(webhook, payload, activeConnection);
      return;
    }
    if (PRODUCT_TOPICS.has(webhook.topic)) {
      await this.refreshCount(webhook, activeConnection, 'product');
      return;
    }
    if (CUSTOMER_TOPICS.has(webhook.topic)) {
      await this.refreshCount(webhook, activeConnection, 'customer');
      return;
    }

    await this.recordReceipt(webhook, connection.id);
  }

  private async upsertCurrentOrder(
    webhook: VerifiedWebhook,
    payload: Record<string, unknown>,
    connection: ConnectedShop & { ecommerceConnectionId: string },
  ): Promise<void> {
    const externalOrderId = orderIdFromPayload(payload, webhook.topic);
    const response = await this.connectionService.graphqlForShopDomain<{
      order?: RawShopifyRevenueOrder | null;
    }>(webhook.domain, ORDER_QUERY, { id: externalOrderId });

    if (!response.order) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.ecommerceOrder.deleteMany({
          where: {
            connectionId: connection.ecommerceConnectionId,
            externalOrderId,
          },
        });
        await this.recordProcessed(transaction, webhook, connection.id);
      });
      return;
    }

    const order = normalizeShopifyOrder(response.order);
    // Resolved outside the transaction below — CustomerRiskService's own
    // upsert is already idempotent/self-contained, and doing it first lets
    // the order write include customerId directly.
    const customer = await this.customerRisk.upsertCustomer({
      storeId: connection.storeId,
      phone: order.customerPhone,
      name: order.customerName,
    });

    const risk = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.ecommerceOrder.findUnique({
        where: {
          connectionId_externalOrderId: {
            connectionId: connection.ecommerceConnectionId,
            externalOrderId: order.externalOrderId,
          },
        },
        select: { providerUpdatedAt: true, status: true },
      });
      if (
        !existing ||
        existing.providerUpdatedAt.getTime() <=
          order.providerUpdatedAt.getTime()
      ) {
        // customerName/customerPhone aren't EcommerceOrder columns (customerId
        // resolved above is) — stripped from the spread, never read directly.
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const {
          lines,
          customerName: _cn,
          customerPhone: _cp,
          ...orderData
        } = order;
        /* eslint-enable @typescript-eslint/no-unused-vars */
        const saved = await transaction.ecommerceOrder.upsert({
          where: {
            connectionId_externalOrderId: {
              connectionId: connection.ecommerceConnectionId,
              externalOrderId: order.externalOrderId,
            },
          },
          create: {
            connectionId: connection.ecommerceConnectionId,
            ...orderData,
            customerId: customer?.id ?? null,
          },
          update: { ...orderData, customerId: customer?.id ?? null },
        });
        const skus = lines
          .map((line) => line.sku)
          .filter((sku): sku is string => Boolean(sku));
        const variants = skus.length
          ? await transaction.warehouseVariant.findMany({
              where: {
                storeId: connection.storeId,
                sku: { in: skus, mode: 'insensitive' },
              },
              select: { id: true, sku: true },
            })
          : [];
        const variantBySku = new Map(
          variants
            .filter((variant) => variant.sku)
            .map((variant) => [
              variant.sku!.toLocaleLowerCase('en-US'),
              variant.id,
            ]),
        );
        await transaction.ecommerceOrderLine.deleteMany({
          where: { orderId: saved.id },
        });
        if (lines.length) {
          await transaction.ecommerceOrderLine.createMany({
            data: lines.map((line) => ({
              orderId: saved.id,
              ...line,
              warehouseVariantId: line.sku
                ? (variantBySku.get(line.sku.toLocaleLowerCase('en-US')) ??
                  null)
                : null,
            })),
            skipDuplicates: true,
          });
        }

        await this.recordProcessed(transaction, webhook, connection.id);
        return {
          orderId: saved.id,
          isNewOrder: !existing,
          justCancelled:
            !!existing &&
            existing.status !== EcommerceOrderStatus.CANCELLED &&
            order.status === EcommerceOrderStatus.CANCELLED,
        };
      }
      await this.recordProcessed(transaction, webhook, connection.id);
      return null;
    });

    if (!risk || !customer) {
      return;
    }
    if (risk.isNewOrder) {
      await this.customerRisk
        .recordNewOrder({
          storeId: connection.storeId,
          customerId: customer.id,
          isBlacklisted: customer.isBlacklisted,
          orderId: risk.orderId,
          occurredAt: order.providerUpdatedAt,
        })
        .catch((err) =>
          this.logger.warn(
            `Customer risk tracking failed for order ${risk.orderId}: ${String(err)}`,
          ),
        );
    } else if (risk.justCancelled) {
      await this.customerRisk
        .incrementRiskCounter(connection.storeId, customer.id, 'CANCELLATIONS')
        .catch((err) =>
          this.logger.warn(
            `Cancellation risk tracking failed for order ${risk.orderId}: ${String(err)}`,
          ),
        );
    }
  }

  private async deleteOrder(
    webhook: VerifiedWebhook,
    payload: Record<string, unknown>,
    connection: ConnectedShop & { ecommerceConnectionId: string },
  ): Promise<void> {
    const externalOrderId = orderIdFromPayload(payload, webhook.topic);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.ecommerceOrder.deleteMany({
        where: {
          connectionId: connection.ecommerceConnectionId,
          externalOrderId,
        },
      });
      await this.recordProcessed(transaction, webhook, connection.id);
    });
  }

  private async refreshCount(
    webhook: VerifiedWebhook,
    connection: ConnectedShop & { ecommerceConnectionId: string },
    resource: 'product' | 'customer',
  ): Promise<void> {
    const response =
      resource === 'product'
        ? await this.connectionService.graphqlForShopDomain<{
            productsCount?: { count?: unknown };
          }>(webhook.domain, PRODUCT_COUNT_QUERY)
        : await this.connectionService.graphqlForShopDomain<{
            customersCount?: { count?: unknown };
          }>(webhook.domain, CUSTOMER_COUNT_QUERY);
    const count = requiredCount(
      resource === 'product'
        ? 'productsCount' in response
          ? response.productsCount?.count
          : undefined
        : 'customersCount' in response
          ? response.customersCount?.count
          : undefined,
      resource,
    );
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.ecommerceConnection.update({
        where: { id: connection.ecommerceConnectionId },
        data: {
          ...(resource === 'product'
            ? { productCount: count }
            : { customerCount: count }),
          metricsSyncedAt: now,
          lastMetricsError: null,
        },
      });
      await this.recordProcessed(transaction, webhook, connection.id, now);
    });
  }

  private async processUninstall(webhook: VerifiedWebhook): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.shopifyWebhookReceipt.create({
        data: {
          webhookId: webhook.webhookId,
          topic: webhook.topic,
          shopDomain: webhook.domain,
        },
      });
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
          lastWebhookAt: new Date(),
          lastWebhookError: null,
        },
      });
      const ecommerceConnectionIds = connections
        .map((item) => item.ecommerceConnectionId)
        .filter((id): id is string => id !== null);
      if (ecommerceConnectionIds.length > 0) {
        await transaction.ecommerceConnection.updateMany({
          where: { id: { in: ecommerceConnectionIds } },
          data: { status: EcommerceConnectionStatus.DISCONNECTED },
        });
      }
    });
  }

  private async processShopRedact(shopDomain: string): Promise<void> {
    const connection = await this.prisma.ecommerceConnection.findFirst({
      where: {
        platform: EcommercePlatform.SHOPIFY,
        externalAccountId: shopDomain,
      },
      select: { storeId: true },
    });

    await this.prisma.$transaction([
      this.prisma.shopifyOAuthState.deleteMany({ where: { shopDomain } }),
      // Cascades to every EcommerceOrder for this connection (see the
      // connection FK's onDelete: Cascade) — order/financial history for
      // this shop goes with it, per shop/redact's scope.
      this.prisma.ecommerceConnection.deleteMany({
        where: {
          platform: EcommercePlatform.SHOPIFY,
          externalAccountId: shopDomain,
        },
      }),
      this.prisma.shopifyConnection.deleteMany({ where: { shopDomain } }),
      this.prisma.shopifyWebhookReceipt.deleteMany({ where: { shopDomain } }),
    ]);

    // Customer rows are store-scoped, not connection-scoped (a phone can be
    // shared across platforms), so they don't cascade with the connection
    // above. Only purge ones now orphaned by it — a customer who also has a
    // YouCan/Lightfunnels/manual order keeps that (non-Shopify-sourced)
    // record; a Shopify-only customer's orders just cascaded to zero.
    if (connection) {
      await this.prisma.customer.deleteMany({
        where: { storeId: connection.storeId, orders: { none: {} } },
      });
    }
  }

  /**
   * CUSTOMERS_REDACT — the mandatory per-customer GDPR erasure. Matches by
   * phone (digits-only, since Shopify's payload format can differ from
   * however the number was originally captured) since that's this
   * module's cross-platform identity key; there is no local email field to
   * match against instead.
   */
  private async processCustomerRedact(
    webhook: VerifiedWebhook,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { shopDomain: webhook.domain },
      select: { id: true, storeId: true },
    });
    const phone = customerPhoneFromPayload(payload);

    if (connection && phone) {
      const targetKey = phoneMatchKey(phone);
      if (targetKey) {
        const candidates = await this.prisma.customer.findMany({
          where: { storeId: connection.storeId },
          select: { id: true, phone: true },
        });
        const matchIds = candidates
          .filter((c) => phoneMatchKey(c.phone) === targetKey)
          .map((c) => c.id);
        if (matchIds.length > 0) {
          await this.prisma.customer.deleteMany({
            where: { id: { in: matchIds } },
          });
        }
      }
    }

    await this.recordReceipt(webhook, connection?.id ?? null);
  }

  private async recordReceipt(
    webhook: VerifiedWebhook,
    connectionId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.recordProcessed(transaction, webhook, connectionId);
    });
  }

  private async recordProcessed(
    transaction: Prisma.TransactionClient,
    webhook: VerifiedWebhook,
    connectionId: string | null,
    processedAt = new Date(),
  ): Promise<void> {
    await transaction.shopifyWebhookReceipt.create({
      data: {
        webhookId: webhook.webhookId,
        topic: webhook.topic,
        shopDomain: webhook.domain,
        processedAt,
      },
    });
    if (connectionId) {
      await transaction.shopifyConnection.update({
        where: { id: connectionId },
        data: { lastWebhookAt: processedAt, lastWebhookError: null },
      });
    }
  }

  private receiptResponse(webhook: VerifiedWebhook, duplicate: boolean) {
    return {
      received: true,
      duplicate,
      topic: webhook.topic,
      webhookId: webhook.webhookId,
    };
  }
}

function parsePayload(rawBody: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new BadRequestException('Shopify webhook body must be valid JSON');
  }
}

function orderIdFromPayload(
  payload: Record<string, unknown>,
  topic: string,
): string {
  const value =
    (topic === 'REFUNDS_CREATE'
      ? (payload.admin_graphql_api_order_id ?? payload.order_id)
      : (payload.admin_graphql_api_id ?? payload.id)) ?? null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(
      `Shopify ${topic} webhook did not include an order identifier`,
    );
  }
  const identifier = String(value).trim();
  if (!identifier) {
    throw new BadRequestException(
      `Shopify ${topic} webhook included an invalid order identifier`,
    );
  }
  return identifier.startsWith('gid://shopify/Order/')
    ? identifier
    : `gid://shopify/Order/${identifier}`;
}

function customerPhoneFromPayload(
  payload: Record<string, unknown>,
): string | null {
  const customer = payload.customer;
  if (!customer || typeof customer !== 'object') {
    return null;
  }
  const phone = (customer as Record<string, unknown>).phone;
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null;
}

// Matches on the trailing subscriber number rather than the full digit
// string — "0612345678" (local) and "+212612345678" (international) are
// the same real number but differ everywhere except their last 9 digits.
// A full-string digit match would silently miss real redact requests
// whenever the two formats disagree, which is the wrong failure mode for
// a legal erasure obligation; matching too broadly (a coincidental 9-digit
// suffix collision) is the safer direction to err in here. Too-short
// numbers return null rather than a match key that could pair up
// unrelated short strings.
const PHONE_MATCH_DIGITS = 9;
function phoneMatchKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= PHONE_MATCH_DIGITS
    ? digits.slice(-PHONE_MATCH_DIGITS)
    : null;
}

function requiredCount(value: unknown, resource: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new BadRequestException(
      `Shopify returned an invalid ${resource} count`,
    );
  }
  return count;
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : 'Shopify webhook processing failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}

import {
  EcommerceConnectionStatus,
  Prisma,
  ShopifyConnectionStatus,
} from '@prisma/client';
import type { Request } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { ShopifyApiService } from './shopify-api.service';
import type { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyWebhookService } from './shopify-webhook.service';

describe('ShopifyWebhookService', () => {
  let capturedConnectionUpdate:
    | Prisma.ShopifyConnectionUpdateManyArgs
    | undefined;
  let capturedEcommerceUpdate: Prisma.EcommerceConnectionUpdateArgs | undefined;
  let capturedOrderUpsert: Prisma.EcommerceOrderUpsertArgs | undefined;
  const receiptFindUnique = jest.fn();
  const receiptCreate = jest.fn();
  const connectionFindUnique = jest.fn();
  const connectionFindMany = jest.fn();
  const connectionUpdate = jest.fn();
  const connectionUpdateMany = jest.fn(
    (args: Prisma.ShopifyConnectionUpdateManyArgs): Promise<unknown> => {
      capturedConnectionUpdate = args;
      return Promise.resolve({});
    },
  );
  const ecommerceConnectionUpdate = jest.fn(
    (args: Prisma.EcommerceConnectionUpdateArgs): Promise<unknown> => {
      capturedEcommerceUpdate = args;
      return Promise.resolve({});
    },
  );
  const ecommerceConnectionUpdateMany = jest.fn();
  const orderFindUnique = jest.fn();
  const orderUpsert = jest.fn(
    (args: Prisma.EcommerceOrderUpsertArgs): Promise<unknown> => {
      capturedOrderUpsert = args;
      return Promise.resolve({ id: 'order-id' });
    },
  );
  const orderDeleteMany = jest.fn();
  const orderLineDeleteMany = jest.fn();
  const orderLineCreateMany = jest.fn();

  const transactionClient = {
    shopifyWebhookReceipt: { create: receiptCreate },
    shopifyConnection: {
      findMany: connectionFindMany,
      update: connectionUpdate,
      updateMany: connectionUpdateMany,
    },
    ecommerceConnection: {
      update: ecommerceConnectionUpdate,
      updateMany: ecommerceConnectionUpdateMany,
    },
    ecommerceOrder: {
      findUnique: orderFindUnique,
      upsert: orderUpsert,
      deleteMany: orderDeleteMany,
    },
    ecommerceOrderLine: {
      deleteMany: orderLineDeleteMany,
      createMany: orderLineCreateMany,
    },
    warehouseVariant: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    shopifyWebhookReceipt: { findUnique: receiptFindUnique },
    shopifyConnection: {
      findUnique: connectionFindUnique,
      updateMany: connectionUpdateMany,
    },
    $transaction: jest.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return (
          input as (client: typeof transactionClient) => Promise<unknown>
        )(transactionClient);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  } as unknown as PrismaService;
  const api = {
    validateWebhook: jest.fn(),
  } as unknown as ShopifyApiService;
  const graphqlForShopDomain = jest.fn();
  const shopifyConnection = {
    graphqlForShopDomain,
  } as unknown as ShopifyConnectionService;
  const service = new ShopifyWebhookService(prisma, api, shopifyConnection);

  beforeEach(() => {
    jest.clearAllMocks();
    capturedConnectionUpdate = undefined;
    capturedEcommerceUpdate = undefined;
    capturedOrderUpsert = undefined;
    receiptFindUnique.mockResolvedValue(null);
    connectionFindUnique.mockResolvedValue({
      id: 'shopify-id',
      storeId: 'store-id',
      status: ShopifyConnectionStatus.ACTIVE,
      ecommerceConnectionId: 'ecommerce-id',
    });
  });

  it('removes credentials after a verified uninstall webhook', async () => {
    mockWebhook('APP_UNINSTALLED');
    connectionFindMany.mockResolvedValue([
      { ecommerceConnectionId: 'ecommerce-id' },
    ]);

    const response = await service.handle(
      {} as Request,
      Buffer.from('{"id":123}'),
    );

    expect(capturedConnectionUpdate?.where).toEqual({
      shopDomain: 'atlas-market.myshopify.com',
    });
    expect(capturedConnectionUpdate?.data).toMatchObject({
      status: ShopifyConnectionStatus.DISCONNECTED,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
    });
    expect(ecommerceConnectionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ecommerce-id'] } },
      data: { status: EcommerceConnectionStatus.DISCONNECTED },
    });
    expect(response).toMatchObject({ received: true, duplicate: false });
  });

  it('refetches and upserts the current order for order webhooks', async () => {
    mockWebhook('ORDERS_UPDATED');
    orderFindUnique.mockResolvedValue(null);
    graphqlForShopDomain.mockResolvedValue({ order: shopifyOrder() });

    await service.handle(
      {} as Request,
      Buffer.from('{"admin_graphql_api_id":"gid://shopify/Order/123"}'),
    );

    expect(graphqlForShopDomain).toHaveBeenCalledWith(
      'atlas-market.myshopify.com',
      expect.stringContaining('query ZomaalWebhookOrder'),
      { id: 'gid://shopify/Order/123' },
    );
    expect(capturedOrderUpsert?.create).toMatchObject({
      connectionId: 'ecommerce-id',
      externalOrderId: 'gid://shopify/Order/123',
      totalCollected: '105.0000',
    });
    expect(receiptCreate).toHaveBeenCalled();
  });

  it('refreshes the exact product count for product events', async () => {
    mockWebhook('PRODUCTS_UPDATE');
    graphqlForShopDomain.mockResolvedValue({ productsCount: { count: 42 } });

    await service.handle({} as Request, Buffer.from('{"id":123}'));

    expect(capturedEcommerceUpdate?.where).toEqual({ id: 'ecommerce-id' });
    expect(capturedEcommerceUpdate?.data).toMatchObject({
      productCount: 42,
      lastMetricsError: null,
    });
  });

  it('refreshes the exact customer count without persisting customer data', async () => {
    mockWebhook('CUSTOMERS_UPDATE');
    graphqlForShopDomain.mockResolvedValue({
      customersCount: { count: 84 },
    });

    await service.handle({} as Request, Buffer.from('{"id":123}'));

    expect(capturedEcommerceUpdate?.data).toMatchObject({
      customerCount: 84,
      lastMetricsError: null,
    });
  });

  it('deletes the normalized projection for Shopify order deletions', async () => {
    mockWebhook('ORDERS_DELETE');

    await service.handle(
      {} as Request,
      Buffer.from('{"admin_graphql_api_id":"gid://shopify/Order/123"}'),
    );

    expect(orderDeleteMany).toHaveBeenCalledWith({
      where: {
        connectionId: 'ecommerce-id',
        externalOrderId: 'gid://shopify/Order/123',
      },
    });
  });

  it('uses the parent order identifier from refund webhooks', async () => {
    mockWebhook('REFUNDS_CREATE');
    orderFindUnique.mockResolvedValue(null);
    graphqlForShopDomain.mockResolvedValue({ order: shopifyOrder() });

    await service.handle(
      {} as Request,
      Buffer.from('{"id":456,"order_id":123}'),
    );

    expect(graphqlForShopDomain).toHaveBeenCalledWith(
      'atlas-market.myshopify.com',
      expect.stringContaining('query ZomaalWebhookOrder'),
      { id: 'gid://shopify/Order/123' },
    );
  });

  it('acknowledges duplicate webhook deliveries without processing again', async () => {
    mockWebhook('ORDERS_UPDATED');
    receiptFindUnique.mockResolvedValue({ webhookId: 'webhook-id' });

    const response = await service.handle(
      {} as Request,
      Buffer.from('{"id":123}'),
    );

    expect(response).toEqual({
      received: true,
      duplicate: true,
      topic: 'ORDERS_UPDATED',
      webhookId: 'webhook-id',
    });
    expect(connectionFindUnique).not.toHaveBeenCalled();
    expect(graphqlForShopDomain).not.toHaveBeenCalled();
  });

  function mockWebhook(topic: string) {
    (api.validateWebhook as jest.Mock).mockResolvedValue({
      topic,
      domain: 'atlas-market.myshopify.com',
      webhookId: 'webhook-id',
    });
  }
});

function shopifyOrder() {
  const money = (amount: string) => ({
    shopMoney: { amount, currencyCode: 'MAD' },
  });
  return {
    id: 'gid://shopify/Order/123',
    name: '#1001',
    closed: false,
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T02:00:00.000Z',
    processedAt: '2026-08-12T01:01:00.000Z',
    cancelledAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    currentSubtotalLineItemsQuantity: 2,
    subtotalPriceSet: money('100'),
    currentSubtotalPriceSet: money('100'),
    totalDiscountsSet: money('10'),
    currentShippingPriceSet: money('5'),
    currentTotalTaxSet: money('0'),
    netPaymentSet: money('105'),
    shippingAddress: { city: 'Casablanca' },
    lineItems: {
      nodes: [
        {
          id: 'line-1',
          title: 'Headphones',
          sku: 'SKU-1',
          quantity: 2,
          product: { id: 'product-1' },
          variant: { id: 'variant-1' },
          originalUnitPriceSet: money('50'),
          priceAfterAllDiscountsBeforeTaxesSet: money('100'),
        },
      ],
    },
  };
}

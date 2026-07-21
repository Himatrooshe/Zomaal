import {
  EcommerceConnectionStatus,
  ShopifyConnectionStatus,
} from '@prisma/client';
import type { Request } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { ShopifyApiService } from './shopify-api.service';
import { ShopifyWebhookService } from './shopify-webhook.service';

describe('ShopifyWebhookService', () => {
  type TransactionClient = typeof transactionClient;
  type TransactionCallback = (client: TransactionClient) => Promise<unknown>;
  type ConnectionUpdateArgs = {
    where: { shopDomain: string };
    data: {
      status: ShopifyConnectionStatus;
      encryptedAccessToken: null;
      encryptedRefreshToken: null;
      accessTokenExpiresAt: null;
      refreshTokenExpiresAt: null;
      disconnectedAt: Date;
    };
  };
  const receiptCreate = jest.fn();
  const connectionFindMany = jest
    .fn()
    .mockResolvedValue([{ ecommerceConnectionId: 'ecommerce-id' }]);
  const connectionUpdateMany = jest.fn();
  const ecommerceConnectionUpdateMany = jest.fn();
  const transactionClient = {
    shopifyWebhookReceipt: { create: receiptCreate },
    shopifyConnection: {
      findMany: connectionFindMany,
      updateMany: connectionUpdateMany,
    },
    ecommerceConnection: { updateMany: ecommerceConnectionUpdateMany },
  };
  const prisma = {
    $transaction: jest.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as TransactionCallback)(transactionClient);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  } as unknown as PrismaService;
  const api = {
    validateWebhook: jest.fn().mockResolvedValue({
      topic: 'APP_UNINSTALLED',
      domain: 'atlas-market.myshopify.com',
      webhookId: 'webhook-id',
    }),
  } as unknown as ShopifyApiService;
  const service = new ShopifyWebhookService(prisma, api);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes credentials after a verified uninstall webhook', async () => {
    const response = await service.handle(
      {} as Request,
      Buffer.from('{"id":123}'),
    );

    expect(receiptCreate).toHaveBeenCalledWith({
      data: {
        webhookId: 'webhook-id',
        topic: 'APP_UNINSTALLED',
        shopDomain: 'atlas-market.myshopify.com',
      },
    });
    expect(connectionUpdateMany).toHaveBeenCalledTimes(1);
    const mockCalls: unknown = connectionUpdateMany.mock.calls;
    const update = (mockCalls as [[ConnectionUpdateArgs]])[0][0];
    expect(update.where).toEqual({
      shopDomain: 'atlas-market.myshopify.com',
    });
    expect(update.data.status).toBe(ShopifyConnectionStatus.DISCONNECTED);
    expect(update.data.encryptedAccessToken).toBeNull();
    expect(update.data.encryptedRefreshToken).toBeNull();
    expect(ecommerceConnectionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ecommerce-id'] } },
      data: { status: EcommerceConnectionStatus.DISCONNECTED },
    });
    expect(response).toEqual({
      received: true,
      duplicate: false,
      topic: 'APP_UNINSTALLED',
      webhookId: 'webhook-id',
    });
  });
});

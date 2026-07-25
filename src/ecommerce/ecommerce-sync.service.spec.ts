import {
  EcommerceConnectionStatus,
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceSyncService } from './ecommerce-sync.service';
import type { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';
import type { ShopifyRevenueAdapter } from './shopify-revenue.adapter';
import type { YouCanRevenueAdapter } from './youcan-revenue.adapter';

describe('EcommerceSyncService', () => {
  const order = {
    externalOrderId: 'gid://shopify/Order/1',
    orderName: '#1001',
    status: EcommerceOrderStatus.CLOSED,
    financialStatus: EcommercePaymentStatus.PAID,
    fulfillmentStatus: 'FULFILLED',
    currency: 'MAD',
    itemCount: 1,
    grossSales: '100.0000',
    discounts: '10.0000',
    refunds: '0.0000',
    netSales: '90.0000',
    shipping: '5.0000',
    tax: '0.0000',
    totalCollected: '95.0000',
    providerCreatedAt: new Date('2026-07-18T10:00:00.000Z'),
    processedAt: new Date('2026-07-18T10:01:00.000Z'),
    cancelledAt: null,
    providerUpdatedAt: new Date('2026-07-19T10:00:00.000Z'),
  };

  it('upserts normalized orders and completes the watermark', async () => {
    const connection = {
      id: 'connection-id',
      platform: EcommercePlatform.SHOPIFY,
      status: EcommerceConnectionStatus.ACTIVE,
      syncCursor: null,
      syncFrom: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      shopifyConnection: { id: 'shopify-id' },
      youCanConnection: null,
      lightfunnelsConnection: null,
    };
    const update = jest.fn().mockResolvedValue(connection);
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue(connection),
        update,
        updateMany: jest.fn(),
      },
      ecommerceOrder: { upsert },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const adapter = {
      fetchOrdersPage: jest.fn().mockResolvedValue({
        orders: [order],
        hasNextPage: false,
        endCursor: null,
      }),
    } as unknown as ShopifyRevenueAdapter;
    const service = new EcommerceSyncService(
      prisma,
      {} as LightfunnelsRevenueAdapter,
      adapter,
      {} as YouCanRevenueAdapter,
    );

    const result = await service.syncConnection('user-id', 'connection-id');

    expect(upsert).toHaveBeenCalledWith({
      where: {
        connectionId_externalOrderId: {
          connectionId: 'connection-id',
          externalOrderId: order.externalOrderId,
        },
      },
      create: { connectionId: 'connection-id', ...order },
      update: order,
    });
    expect(result).toEqual({
      connectionId: 'connection-id',
      platform: EcommercePlatform.SHOPIFY,
      processedOrders: 1,
      hasMore: false,
      lastSyncedAt: result.lastSyncedAt,
    });
    expect(typeof result.lastSyncedAt).toBe('string');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not reveal whether another user owns a connection', async () => {
    const prisma = {
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const service = new EcommerceSyncService(
      prisma,
      {} as LightfunnelsRevenueAdapter,
      {} as ShopifyRevenueAdapter,
      {} as YouCanRevenueAdapter,
    );

    await expect(
      service.syncConnection('user-id', 'unknown-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dispatches YouCan connections to the YouCan adapter', async () => {
    const connection = {
      id: 'youcan-connection-id',
      platform: EcommercePlatform.YOUCAN,
      status: EcommerceConnectionStatus.ACTIVE,
      syncCursor: null,
      syncFrom: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      shopifyConnection: null,
      youCanConnection: { id: 'youcan-id' },
      lightfunnelsConnection: null,
    };
    const update = jest.fn().mockResolvedValue(connection);
    const prisma = {
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue(connection),
        update,
        updateMany: jest.fn(),
      },
      ecommerceOrder: { upsert: jest.fn() },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const fetchOrdersPage = jest.fn().mockResolvedValue({
      orders: [],
      hasNextPage: false,
      endCursor: null,
    });
    const youCanAdapter = {
      fetchOrdersPage,
    } as unknown as YouCanRevenueAdapter;
    const service = new EcommerceSyncService(
      prisma,
      {} as LightfunnelsRevenueAdapter,
      {} as ShopifyRevenueAdapter,
      youCanAdapter,
    );

    const result = await service.syncConnection(
      'user-id',
      'youcan-connection-id',
    );

    expect(fetchOrdersPage).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.platform).toBe(EcommercePlatform.YOUCAN);
    expect(result.hasMore).toBe(false);
  });

  it('dispatches Lightfunnels connections to the Lightfunnels adapter', async () => {
    const connection = {
      id: 'lightfunnels-connection-id',
      platform: EcommercePlatform.LIGHTFUNNELS,
      status: EcommerceConnectionStatus.ACTIVE,
      syncCursor: null,
      syncFrom: null,
      syncStartedAt: null,
      lastSyncedAt: null,
      shopifyConnection: null,
      youCanConnection: null,
      lightfunnelsConnection: { id: 'lightfunnels-id' },
    };
    const update = jest.fn().mockResolvedValue(connection);
    const prisma = {
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue(connection),
        update,
        updateMany: jest.fn(),
      },
      ecommerceOrder: { upsert: jest.fn() },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const fetchOrdersPage = jest.fn().mockResolvedValue({
      orders: [],
      hasNextPage: false,
      endCursor: null,
    });
    const lightfunnelsAdapter = {
      fetchOrdersPage,
    } as unknown as LightfunnelsRevenueAdapter;
    const service = new EcommerceSyncService(
      prisma,
      lightfunnelsAdapter,
      {} as ShopifyRevenueAdapter,
      {} as YouCanRevenueAdapter,
    );

    const result = await service.syncConnection(
      'user-id',
      'lightfunnels-connection-id',
    );

    expect(fetchOrdersPage).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.platform).toBe(EcommercePlatform.LIGHTFUNNELS);
    expect(result.hasMore).toBe(false);
  });
});

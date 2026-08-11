import { EcommercePlatform } from '@prisma/client';
import { EcommerceMetricsService } from './ecommerce-metrics.service';

describe('EcommerceMetricsService', () => {
  it('refreshes Shopify product and customer counts without storing PII', async () => {
    const prisma = {
      ecommerceConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'connection-id',
          platform: EcommercePlatform.SHOPIFY,
          status: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    const shopify = {
      graphqlForUser: jest.fn().mockResolvedValue({
        productsCount: { count: 125 },
        customersCount: { count: 840 },
      }),
    };
    const service = new EcommerceMetricsService(
      prisma as any,
      shopify as any,
      {} as any,
      {} as any,
    );

    const result = await service.refreshConnectionMetrics(
      'user-id',
      'connection-id',
    );

    expect(shopify.graphqlForUser).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('productsCount'),
    );
    expect(prisma.ecommerceConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-id' },
      data: expect.objectContaining({
        productCount: 125,
        customerCount: 840,
        lastMetricsError: null,
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        platform: EcommercePlatform.SHOPIFY,
        productCount: 125,
        customerCount: 840,
      }),
    );
  });
});

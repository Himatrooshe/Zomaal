import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';

describe('EcommerceService', () => {
  it('returns provider-neutral product lines for an internal order ID', async () => {
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: '12345678-1234-1234-1234-123456789012',
          externalOrderId: 'gid://shopify/Order/42',
          connection: { platform: 'SHOPIFY' },
        }),
      },
    } as any;
    const sourceProducts = {
      platform: 'SHOPIFY',
      externalOrderId: 'gid://shopify/Order/42',
      orderReference: '#42',
      currency: 'MAD',
      complete: true,
      products: [
        {
          lineItemId: 'gid://shopify/LineItem/1',
          productId: 'gid://shopify/Product/10',
          variantId: 'gid://shopify/ProductVariant/11',
          title: 'Leather bag',
          variantTitle: 'Brown',
          sku: 'BAG-BROWN',
          quantity: 2,
          unitPrice: '149.9000',
          totalPrice: '299.8000',
          currency: 'MAD',
          imageUrl: null,
        },
      ],
    };
    const shopify = {
      fetchOrderProducts: jest.fn().mockResolvedValue(sourceProducts),
    };
    const service = new EcommerceService(
      prisma,
      shopify as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.getOrderProducts(
        'user-id',
        '12345678-1234-1234-1234-123456789012',
      ),
    ).resolves.toEqual({
      orderId: '12345678-1234-1234-1234-123456789012',
      ...sourceProducts,
      itemCount: 2,
      productLineCount: 1,
    });
    expect(shopify.fetchOrderProducts).toHaveBeenCalledWith(
      'user-id',
      'gid://shopify/Order/42',
    );
  });

  it('dispatches a normalized order through the selected real courier client', async () => {
    const order = {
      id: '12345678-1234-1234-1234-123456789012',
      externalOrderId: 'gid://shopify/Order/42',
      connection: { platform: 'SHOPIFY' },
      dispatch: null,
    };
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      ecommerceOrderDispatch: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({ status: 'DISPATCHED' }),
        updateMany: jest.fn(),
      },
    } as any;
    const fulfillment = {
      platform: 'SHOPIFY',
      externalOrderId: order.externalOrderId,
      orderReference: '#42',
      recipientName: 'Sara Amrani',
      recipientPhone: '0612345678',
      address: '12 Rue Al Massira',
      city: 'Casablanca',
      country: 'Morocco',
      currency: 'MAD',
      codAmount: '349.90',
      lineItems: [{ title: 'Leather bag', sku: 'BAG-1', quantity: 1 }],
      notes: 'Call first',
      status: 'OPEN',
      financialStatus: 'PENDING',
      fulfillmentStatus: 'UNFULFILLED',
    };
    const shopifyFulfillment = {
      fetchFulfillmentPreview: jest.fn().mockResolvedValue(fulfillment),
    };
    const shipping = {
      createQuickLivraisonDelivery: jest.fn().mockResolvedValue({
        success: 'Colis ajouté avec succès.',
        tracking_number: 'PARCEL_12345678',
      }),
    };
    const service = new EcommerceService(
      prisma,
      shopifyFulfillment as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockResolvedValue(new Prisma.Decimal('349.90')),
      } as any,
      shipping as any,
    );

    const result = await service.dispatchOrder('user-id', order.id, {
      provider: 'QUICKLIVRAISON' as any,
      options: { destinationDistrictId: 123, allowOpen: true },
    });

    expect(shipping.createQuickLivraisonDelivery).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({
        district_id: 123,
        name: 'Sara Amrani',
        amount: 349.9,
        code: 'ORD-12345678',
        open: true,
      }),
    );
    expect(prisma.ecommerceOrderDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(prisma.ecommerceOrderDispatch.update).toHaveBeenCalledWith({
      where: { orderId: order.id },
      data: expect.objectContaining({
        status: 'DISPATCHED',
        providerTracking: 'PARCEL_12345678',
      }),
    });
    expect(result).toEqual({
      trackingNumber: 'PARCEL_12345678',
      status: 'DISPATCHED',
      provider: 'QUICKLIVRAISON',
      merchantTracking: 'ORD-12345678',
    });
  });

  it('converts all platform revenue to the store base currency', async () => {
    const rows = [
      aggregateRow('SHOPIFY', 'MAD', '100.0000'),
      aggregateRow('YOUCAN', 'AED', '50.0000'),
      aggregateRow('LIGHTFUNNELS', 'USD', '25.0000'),
    ];
    const prisma = {
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'store-id', baseCurrency: 'MAD' }),
      },
      ecommerceConnection: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { lastSyncedAt: new Date('2026-07-19T10:00:00.000Z') },
          ]),
      },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockImplementation(async (amount, from, to) => {
            if (from === 'MAD') return amount;
            if (from === 'AED') return amount.times(new Prisma.Decimal(2)); // mock AED -> MAD = x2
            if (from === 'USD') return amount.times(new Prisma.Decimal(10)); // mock USD -> MAD = x10
            return amount;
          }),
      } as any,
      {} as any,
    );

    const result = await service.getRevenueSummary('user-id', {
      timezone: 'Africa/Casablanca',
    });

    expect(result.totalsByCurrency).toHaveLength(1);
    expect(result.totalsByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'MAD',
          totalCollected: '450.0000', // 100 + (50 * 2) + (25 * 10) = 450
        }),
      ]),
    );
    expect(result.byPlatform).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'SHOPIFY',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'YOUCAN',
          currency: 'MAD',
          totalCollected: '100.0000',
        }),
        expect.objectContaining({
          platform: 'LIGHTFUNNELS',
          currency: 'MAD',
          totalCollected: '250.0000',
        }),
      ]),
    );
    expect(result.dataFreshAsOf).toBe('2026-07-19T10:00:00.000Z');
  });

  it('rejects invalid calendar dates before querying revenue', async () => {
    const queryRaw = jest.fn();
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'store-id' }),
      },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new EcommerceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {
        convertAmount: jest
          .fn()
          .mockImplementation(async (amount, from, to) => amount),
      } as any,
      {} as any,
    );

    await expect(
      service.getRevenueSummary('user-id', {
        from: '2026-02-31',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

function aggregateRow(
  platform: string,
  currency: string,
  totalCollected: string,
) {
  return {
    platform,
    currency,
    orderCount: 1,
    grossSales: new Prisma.Decimal(totalCollected),
    discounts: new Prisma.Decimal(0),
    refunds: new Prisma.Decimal(0),
    netSales: new Prisma.Decimal(totalCollected),
    shipping: new Prisma.Decimal(0),
    tax: new Prisma.Decimal(0),
    totalCollected: new Prisma.Decimal(totalCollected),
  };
}

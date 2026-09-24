import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ShopOrderCancelledBy, ShopOrderStatus } from '@prisma/client';
import { ShopOrdersService } from './shop-orders.service';

function build() {
  const prisma = {
    shopOrder: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    shopPromoCode: { updateMany: jest.fn() },
    shopProductVariant: { updateMany: jest.fn() },
    shopProduct: { updateMany: jest.fn() },
    merchantPurchase: { createMany: jest.fn() },
  };
  const $transaction = jest.fn((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const packaging = {
    creditDeliveredPurchase: jest.fn().mockResolvedValue({}),
  };
  const service = new ShopOrdersService(
    { ...prisma, $transaction } as never,
    packaging as never,
  );
  return { service, prisma, packaging };
}

describe('ShopOrdersService.cancel', () => {
  it('flips the status conditionally so a concurrent cancel/ship cannot both win', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'o1',
      promoCodeId: null,
      items: [],
    });

    await service.cancel(
      'o1',
      ShopOrderCancelledBy.MERCHANT,
      'changed my mind',
      [ShopOrderStatus.PENDING],
    );

    const calls = prisma.shopOrder.updateMany.mock.calls as unknown[][];
    const call = calls[0][0] as {
      where: unknown;
      data: {
        status: unknown;
        cancelledBy: unknown;
        cancelReason: unknown;
      };
    };
    expect(call.where).toEqual({
      id: 'o1',
      status: { in: [ShopOrderStatus.PENDING] },
    });
    expect(call.data.status).toBe(ShopOrderStatus.CANCELLED);
    expect(call.data.cancelledBy).toBe(ShopOrderCancelledBy.MERCHANT);
    expect(call.data.cancelReason).toBe('changed my mind');
  });

  it('gives the merchant a support-desk message when it is no longer cancellable from the app', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.CONFIRMED,
    });

    await expect(
      service.cancel('o1', ShopOrderCancelledBy.MERCHANT, undefined, [
        ShopOrderStatus.PENDING,
      ]),
    ).rejects.toThrow(/Contact Zomaal support/);
  });

  it('gives the admin a plain conflict message', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.DELIVERED,
    });

    await expect(
      service.cancel('o1', ShopOrderCancelledBy.ADMIN, undefined, [
        ShopOrderStatus.PENDING,
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('restocks every item and releases one promo use', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'o1',
      promoCodeId: 'promo-1',
      items: [
        { productId: 'p1', variantId: 'v1', quantity: 2 },
        { productId: 'p2', variantId: null, quantity: 1 },
      ],
    });

    await service.cancel('o1', ShopOrderCancelledBy.ADMIN, 'refused', [
      ShopOrderStatus.SHIPPED,
    ]);

    expect(prisma.shopProductVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { stock: { increment: 2 } },
    });
    expect(prisma.shopProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stock: { increment: 2 } },
    });
    expect(prisma.shopProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 'p2' },
      data: { stock: { increment: 1 } },
    });
    expect(prisma.shopPromoCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'promo-1', usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  });
});

describe('ShopOrdersService.advance', () => {
  it('rejects moving to PENDING or an unknown status', async () => {
    const { service } = build();
    await expect(
      service.advance('o1', ShopOrderStatus.PENDING),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a conflicting move once another request already moved the order', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.SHIPPED,
      paymentMethod: 'COD',
      confirmedAt: new Date(),
      shippedAt: new Date(),
    });
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.advance('o1', ShopOrderStatus.CONFIRMED),
    ).rejects.toThrow(ConflictException);
  });

  it('stamps confirmedAt and shippedAt when skipping straight to SHIPPED', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.PENDING,
      paymentMethod: 'COD',
      confirmedAt: null,
      shippedAt: null,
    });
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.advance('o1', ShopOrderStatus.SHIPPED, {
      trackingNumber: 'TRK1',
    });

    const calls1 = prisma.shopOrder.updateMany.mock.calls as unknown[][];
    const data = (
      calls1[0][0] as {
        data: {
          status: unknown;
          confirmedAt: unknown;
          shippedAt: unknown;
          trackingNumber: unknown;
        };
      }
    ).data;
    expect(data.status).toBe(ShopOrderStatus.SHIPPED);
    expect(data.confirmedAt).toBeInstanceOf(Date);
    expect(data.shippedAt).toBeInstanceOf(Date);
    expect(data.trackingNumber).toBe('TRK1');
  });

  it('marks a COD order PAID, records purchases, and credits packaging on DELIVERED', async () => {
    const { service, prisma, packaging } = build();
    prisma.shopOrder.findUnique
      .mockResolvedValueOnce({
        status: ShopOrderStatus.SHIPPED,
        paymentMethod: 'COD',
        confirmedAt: new Date(),
        shippedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'o1',
        storeId: 'store-1',
        items: [
          {
            id: 'item-1',
            productId: 'p1',
            variantId: 'v1',
            productName: 'Large Box',
            quantity: 2,
            product: {
              sku: 'BOX-L',
              images: [{ objectName: 'shop/products/p1/img.webp' }],
            },
            variant: { sku: 'BOX-L-BRN' },
          },
        ],
      });
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'o1',
      number: 7,
      storeId: 'store-1',
      currency: 'MAD',
      placedByUserId: 'user-1',
      items: [
        {
          id: 'item-1',
          productId: 'p1',
          productName: 'Shirt',
          variantLabel: 'M · Red',
          unitLabel: 'piece',
          imageUrl: null,
          quantity: 2,
          unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(200),
        },
      ],
    });

    await service.advance('o1', ShopOrderStatus.DELIVERED);

    const calls2 = prisma.shopOrder.updateMany.mock.calls as unknown[][];
    const data = (
      calls2[0][0] as {
        data: { paymentStatus: unknown; deliveredAt: unknown };
      }
    ).data;
    expect(data.paymentStatus).toBe('PAID');
    expect(data.deliveredAt).toBeInstanceOf(Date);
    expect(prisma.merchantPurchase.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            storeId: 'store-1',
            source: 'SHOP',
            shopProductId: 'p1',
            shopOrderItemId: 'item-1',
            productName: 'Shirt',
            notes: 'Zomaal Shop order ZS-7 · M · Red',
          }),
        ],
      }),
    );
    expect(packaging.creditDeliveredPurchase).toHaveBeenCalledWith('store-1', {
      zomaalShopVariantId: 'v1',
      name: 'Large Box',
      sku: 'BOX-L-BRN',
      imageObjectName: 'shop/products/p1/img.webp',
      quantity: 2,
      deliveryReference: 'item-1',
    });
  });

  it('does not mark ONLINE orders paid on delivery', async () => {
    const { service, prisma, packaging } = build();
    prisma.shopOrder.findUnique
      .mockResolvedValueOnce({
        status: ShopOrderStatus.SHIPPED,
        paymentMethod: 'ONLINE',
        confirmedAt: new Date(),
        shippedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'o1',
        storeId: 'store-1',
        items: [],
      });
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'o1',
      number: 1,
      storeId: 'store-1',
      currency: 'MAD',
      placedByUserId: 'user-1',
      items: [],
    });

    await service.advance('o1', ShopOrderStatus.DELIVERED);

    const calls3 = prisma.shopOrder.updateMany.mock.calls as unknown[][];
    const data = (calls3[0][0] as { data: { paymentStatus?: unknown } }).data;
    expect(data.paymentStatus).toBeUndefined();
    expect(packaging.creditDeliveredPurchase).not.toHaveBeenCalled();
  });
});

describe('ShopOrdersService.buildStatusSteps', () => {
  const base = {
    createdAt: new Date('2026-04-20T10:30:00.000Z'),
    confirmedAt: new Date('2026-04-20T11:00:00.000Z'),
    shippedAt: new Date('2026-04-21T09:00:00.000Z'),
    deliveredAt: null as Date | null,
    cancelledAt: null as Date | null,
    trackingNumber: '1234567890',
  };

  it('marks Out for delivery as current when SHIPPED', () => {
    const { service } = build();
    const steps = service.buildStatusSteps({
      ...base,
      status: ShopOrderStatus.SHIPPED,
    });
    expect(steps.map((s) => s.key)).toEqual([
      'PLACED',
      'CONFIRMED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    expect(steps.find((s) => s.key === 'OUT_FOR_DELIVERY')).toMatchObject({
      current: true,
      completed: false,
    });
    expect(steps.find((s) => s.key === 'SHIPPED')?.trackingNumber).toBe(
      '1234567890',
    );
  });

  it('completes all forward steps when DELIVERED', () => {
    const { service } = build();
    const steps = service.buildStatusSteps({
      ...base,
      status: ShopOrderStatus.DELIVERED,
      deliveredAt: new Date('2026-04-22T12:00:00.000Z'),
    });
    expect(steps.every((s) => s.completed)).toBe(true);
    expect(steps.find((s) => s.key === 'DELIVERED')?.current).toBe(true);
  });
});

describe('ShopOrdersService.listForStore', () => {
  it('filters Processing tab as PENDING + CONFIRMED and exposes lastUpdate', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.findMany.mockResolvedValue([
      {
        id: 'o1',
        number: 12,
        status: ShopOrderStatus.CONFIRMED,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        currency: 'MAD',
        total: new Prisma.Decimal(100),
        trackingNumber: null,
        createdAt: new Date('2026-03-15T00:00:00.000Z'),
        items: [
          { quantity: 1, imageUrl: null, productName: 'Box' },
        ],
      },
    ]);

    const rows = await service.listForStore('store-1', {
      tab: 'PROCESSING',
      search: 'box',
    });

    expect(prisma.shopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 'store-1',
          status: {
            in: [ShopOrderStatus.PENDING, ShopOrderStatus.CONFIRMED],
          },
          items: {
            some: {
              productName: { contains: 'box', mode: 'insensitive' },
            },
          },
        }),
      }),
    );
    expect(rows[0]).toMatchObject({
      listTab: 'PROCESSING',
      lastUpdate: 'Order confirmed',
      number: 'ZS-12',
    });
  });
});

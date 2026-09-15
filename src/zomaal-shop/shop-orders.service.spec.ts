import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ShopOrderCancelledBy, ShopOrderStatus } from '@prisma/client';
import { ShopOrdersService } from './shop-orders.service';

function build() {
  const prisma = {
    shopOrder: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    shopPromoCode: { updateMany: jest.fn() },
    shopProductVariant: { updateMany: jest.fn() },
    shopProduct: { updateMany: jest.fn() },
    merchantPurchase: { createMany: jest.fn() },
  };
  const $transaction = jest.fn((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const service = new ShopOrdersService({ ...prisma, $transaction } as never);
  return { service, prisma };
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

  it('marks a COD order PAID and records "From Shop" purchases on DELIVERED', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.SHIPPED,
      paymentMethod: 'COD',
      confirmedAt: new Date(),
      shippedAt: new Date(),
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
  });

  it('does not mark ONLINE orders paid on delivery', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.findUnique.mockResolvedValue({
      status: ShopOrderStatus.SHIPPED,
      paymentMethod: 'ONLINE',
      confirmedAt: new Date(),
      shippedAt: new Date(),
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
    const data = (calls3[0][0] as { data: { paymentStatus: unknown } }).data;
    expect(data.paymentStatus).toBeUndefined();
  });
});

describe('ShopOrdersService response shaping', () => {
  const service = new ShopOrdersService({} as never);
  const base = {
    id: 'o1',
    number: 3,
    status: ShopOrderStatus.CONFIRMED,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    currency: 'MAD',
    subtotal: new Prisma.Decimal(0),
    discount: new Prisma.Decimal(0),
    deliveryFee: new Prisma.Decimal(0),
    total: new Prisma.Decimal(0),
    promoCode: null,
    items: [],
    shipLabel: null,
    shipName: 'A',
    shipPhone: '+2126',
    shipCountry: 'MA',
    shipCity: 'Casa',
    shipDistrict: null,
    shipAddress: 'St',
    note: null,
    trackingNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    confirmedAt: new Date(),
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    adminNote: null,
    store: {
      id: 's1',
      businessName: 'Shop',
      ownerName: 'Owner',
      user: { id: 'u1', phone: '+2126' },
    },
  };

  it('merchant cannot cancel a confirmed order; admin can', () => {
    expect(service.toMerchantResponse(base as never).canCancel).toBe(false);
    expect(service.toAdminResponse(base as never).canCancel).toBe(true);
  });

  it('lists remaining forward statuses only', () => {
    expect(service.toAdminResponse(base as never).nextStatuses).toEqual([
      'SHIPPED',
      'DELIVERED',
    ]);
  });

  it('offers no next statuses once cancelled', () => {
    expect(
      service.toAdminResponse({
        ...base,
        status: ShopOrderStatus.CANCELLED,
      } as never).nextStatuses,
    ).toEqual([]);
  });
});

import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, ShopPaymentMethod } from '@prisma/client';
import { CheckoutService } from './checkout.service';

const SETTINGS = {
  currency: 'MAD',
  deliveryFee: new Prisma.Decimal(20),
  freeDeliveryMinSubtotal: null,
  codEnabled: true,
  codCancellationLimit: 3,
  codCancellationWindowDays: 90,
};

const ACCESS = {
  storeId: 'store-1',
  userId: 'user-1',
  baseCurrency: 'MAD',
  isOwner: true,
} as never;

function buildLine(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: 'row-1',
      productId: 'p1',
      variantId: null,
      quantity: 2,
      product: { name: 'Box', unitLabel: 'piece', images: [] },
      variant: null,
    },
    unitPrice: new Prisma.Decimal(50),
    compareAtPrice: null,
    stock: 10,
    problem: null,
    ...overrides,
  };
}

function build() {
  const prisma = {
    shopOrder: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    shopPromoCode: { findUnique: jest.fn().mockResolvedValue(null) },
    store: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ isActive: true }),
    },
    shopCartItem: { deleteMany: jest.fn() },
    shopProductVariant: { updateMany: jest.fn(), aggregate: jest.fn() },
    shopProduct: { updateMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const settingsService = { get: jest.fn().mockResolvedValue(SETTINGS) };
  const cart = {
    rows: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockReturnValue([]),
    lineResponse: jest.fn((l: unknown) => l),
  };
  const addresses = {
    require: jest.fn(),
    defaultFor: jest.fn(),
    toResponse: jest.fn((a: unknown) => a),
  };
  const orders = { toMerchantResponse: jest.fn((o: unknown) => o) };
  const service = new CheckoutService(
    prisma as never,
    settingsService as never,
    cart as never,
    addresses as never,
    orders as never,
  );
  return { service, prisma, settingsService, cart, addresses, orders };
}

describe('CheckoutService.codRestriction', () => {
  it('is not restricted when the limit is 0 (disabled)', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.count.mockResolvedValue(999);
    const result = await service.codRestriction('store-1', {
      ...SETTINGS,
      codCancellationLimit: 0,
    } as never);
    expect(result.restricted).toBe(false);
  });

  it('is restricted once cancellations reach the limit', async () => {
    const { service, prisma } = build();
    prisma.shopOrder.count.mockResolvedValue(3);
    const result = await service.codRestriction('store-1', SETTINGS as never);
    expect(result).toEqual({
      cancellations: 3,
      limit: 3,
      windowDays: 90,
      restricted: true,
    });
  });

  it('counts merchant cancellations and admin cancellations of already-shipped orders', async () => {
    const { service, prisma } = build();
    await service.codRestriction('store-1', SETTINGS as never);
    const calls = prisma.shopOrder.count.mock.calls as unknown[][];
    const call = calls[0][0] as { where: { OR: unknown } };
    expect(call.where.OR).toEqual([
      { cancelledBy: 'MERCHANT' },
      { cancelledBy: 'ADMIN', shippedAt: { not: null } },
    ]);
  });
});

describe('CheckoutService.preview', () => {
  it('blocks when the account is suspended, the cart is empty, and no address exists', async () => {
    const { service, prisma, addresses } = build();
    prisma.store.findUniqueOrThrow.mockResolvedValue({ isActive: false });
    addresses.defaultFor.mockResolvedValue(null);

    const result = await service.preview(ACCESS, {});
    const codes = result.blockers.map((b: { code: string }) => b.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ACCOUNT_SUSPENDED',
        'CART_EMPTY',
        'ADDRESS_REQUIRED',
      ]),
    );
    expect(result.canPlaceOrder).toBe(false);
  });

  it('flags COD_RESTRICTED distinctly from COD_DISABLED', async () => {
    const { service, prisma, addresses, cart } = build();
    addresses.defaultFor.mockResolvedValue({ id: 'a1' });
    cart.evaluate.mockReturnValue([buildLine()]);
    prisma.shopOrder.count.mockResolvedValue(5); // over the limit of 3

    const result = await service.preview(ACCESS, {});
    expect(
      result.blockers.some(
        (b: { code: string }) => b.code === 'COD_RESTRICTED',
      ),
    ).toBe(true);
    expect(result.paymentMethods[0].available).toBe(false);
  });

  it('always reports ONLINE as unavailable', async () => {
    const { service, addresses } = build();
    addresses.defaultFor.mockResolvedValue({ id: 'a1' });
    const result = await service.preview(ACCESS, {});
    expect(result.paymentMethods[1].method).toBe('ONLINE');
    expect(result.paymentMethods[1].available).toBe(false);
    expect(result.paymentMethods[1].reason).toContain('Cash on Delivery');
  });
});

describe('CheckoutService.placeOrder', () => {
  it('rejects ONLINE payment outright, before touching the cart', async () => {
    const { service, cart } = build();
    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.ONLINE,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(cart.rows).not.toHaveBeenCalled();
  });

  it('refuses a COD order once the merchant is restricted', async () => {
    const { service, prisma, addresses, cart } = build();
    addresses.require.mockResolvedValue({ id: 'a1' });
    cart.evaluate.mockReturnValue([buildLine()]);
    prisma.shopOrder.count.mockResolvedValue(3);

    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.COD,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an order for a suspended account', async () => {
    const { service, prisma, addresses, cart } = build();
    prisma.store.findUniqueOrThrow.mockResolvedValue({ isActive: false });
    addresses.require.mockResolvedValue({ id: 'a1' });
    cart.evaluate.mockReturnValue([buildLine()]);

    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.COD,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses to place an order when a typed promo code did not apply', async () => {
    const { service, prisma, addresses, cart } = build();
    addresses.require.mockResolvedValue({ id: 'a1' });
    cart.evaluate.mockReturnValue([buildLine()]);
    prisma.shopPromoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      isActive: false,
    });

    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.COD,
        promoCode: 'DEAD',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rolls back with a friendly error when the cart changed under a double submit', async () => {
    const { service, prisma, addresses, cart } = build();
    addresses.require.mockResolvedValue({
      id: 'a1',
      label: 'Home',
      fullName: 'A',
      phone: '+2126',
      country: 'MA',
      city: 'Casa',
      district: null,
      address: 'St',
    });
    cart.evaluate.mockReturnValue([buildLine()]);
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      const tx = {
        shopCartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return fn(tx);
    });

    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.COD,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('reserves stock conditionally and rejects with a clear message on a shortfall', async () => {
    const { service, prisma, addresses, cart } = build();
    addresses.require.mockResolvedValue({
      id: 'a1',
      label: 'Home',
      fullName: 'A',
      phone: '+2126',
      country: 'MA',
      city: 'Casa',
      district: null,
      address: 'St',
    });
    cart.evaluate.mockReturnValue([buildLine()]);
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      const tx = {
        shopCartItem: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        shopProduct: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        shopProductVariant: { updateMany: jest.fn(), aggregate: jest.fn() },
      };
      return fn(tx);
    });

    await expect(
      service.placeOrder(ACCESS, {
        addressId: 'a1',
        paymentMethod: ShopPaymentMethod.COD,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates the order and keeps product.stock equal to the sum of its variants', async () => {
    const { service, prisma, addresses, cart, orders } = build();
    const address = {
      id: 'a1',
      label: 'Home',
      fullName: 'A',
      phone: '+2126',
      country: 'MA',
      city: 'Casa',
      district: null,
      address: 'St',
    };
    addresses.require.mockResolvedValue(address);
    cart.evaluate.mockReturnValue([
      buildLine({
        row: {
          id: 'row-1',
          productId: 'p1',
          variantId: 'v1',
          quantity: 2,
          product: { name: 'Shirt', unitLabel: 'piece', images: [] },
          variant: { size: 'M', color: 'Red' },
        },
      }),
    ]);
    let createdOrderId = '';
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          shopCartItem: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          shopProductVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            aggregate: jest.fn().mockResolvedValue({ _sum: { stock: 3 } }),
          },
          shopProduct: {
            update: jest.fn(),
            updateMany: jest.fn(),
          },
          shopOrder: {
            create: jest.fn().mockResolvedValue({ id: 'order-1' }),
          },
        };
        const id = (await fn(tx)) as string;
        createdOrderId = id;
        expect(tx.shopProduct.update).toHaveBeenCalledWith({
          where: { id: 'p1' },
          data: { stock: 3 },
        });
        return id;
      },
    );
    prisma.shopOrder.findUniqueOrThrow.mockResolvedValue({ id: 'order-1' });

    await service.placeOrder(ACCESS, {
      addressId: 'a1',
      paymentMethod: ShopPaymentMethod.COD,
    });
    expect(createdOrderId).toBe('order-1');
    expect(orders.toMerchantResponse).toHaveBeenCalledWith({ id: 'order-1' });
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MerchantPurchaseSource, Prisma } from '@prisma/client';
import { PurchasesService } from './purchases.service';

const ACCESS = {
  storeId: 'store-1',
  userId: 'user-1',
  baseCurrency: 'MAD',
} as never;

function build() {
  const prisma = {
    merchantPurchase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    warehouseProduct: { findFirst: jest.fn(), findMany: jest.fn() },
    store: { findUniqueOrThrow: jest.fn() },
  };
  const service = new PurchasesService(prisma as never);
  return { service, prisma };
}

describe('PurchasesService.list grouping', () => {
  it('groups a delivered shop product and a since-deleted one separately, and keeps currencies apart', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findMany.mockResolvedValue([
      {
        source: MerchantPurchaseSource.SHOP,
        shopProductId: 'p1',
        warehouseProductId: null,
        productName: 'Shirt',
        unitLabel: 'piece',
        imageUrl: null,
        quantity: 2,
        unitPrice: new Prisma.Decimal(100),
        totalCost: new Prisma.Decimal(200),
        currency: 'MAD',
        purchaseDate: new Date('2026-01-01'),
      },
      {
        source: MerchantPurchaseSource.SHOP,
        shopProductId: 'p1',
        warehouseProductId: null,
        productName: 'Shirt',
        unitLabel: 'piece',
        imageUrl: null,
        quantity: 1,
        unitPrice: new Prisma.Decimal(100),
        totalCost: new Prisma.Decimal(100),
        currency: 'MAD',
        purchaseDate: new Date('2026-02-01'),
      },
      {
        source: MerchantPurchaseSource.SHOP,
        shopProductId: null, // product since deleted from the shop
        warehouseProductId: null,
        productName: 'Old Product',
        unitLabel: 'piece',
        imageUrl: null,
        quantity: 1,
        unitPrice: new Prisma.Decimal(50),
        totalCost: new Prisma.Decimal(50),
        currency: 'USD',
        purchaseDate: new Date('2026-01-15'),
      },
    ]);

    const result = await service.list('store-1', {});
    expect(result.summary.productCount).toBe(2);
    expect(result.summary.purchaseCount).toBe(3);
    expect(result.summary.totalItems).toBe(4);
    // Two currencies present => no single totalSpent/currency figure.
    expect(result.summary.totalSpent).toBeNull();
    expect(result.summary.totalSpentByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'MAD', amount: '300.00' },
        { currency: 'USD', amount: '50.00' },
      ]),
    );
    const shirtGroup = result.items.find(
      (i: { key: string }) => i.key === 's_p1',
    );
    expect(shirtGroup).toBeDefined();
    expect(shirtGroup?.totalQuantity).toBe(3);
    expect(shirtGroup?.totalCost).toBe('300.00');
    expect(shirtGroup?.purchaseCount).toBe(2);
  });

  it('reports a single currency total when everything is in one currency', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findMany.mockResolvedValue([
      {
        source: MerchantPurchaseSource.MANUAL,
        shopProductId: null,
        warehouseProductId: 'wp1',
        productName: 'Cable',
        unitLabel: 'piece',
        imageUrl: null,
        quantity: 5,
        unitPrice: new Prisma.Decimal(10),
        totalCost: new Prisma.Decimal(50),
        currency: 'MAD',
        purchaseDate: new Date(),
      },
    ]);
    const result = await service.list('store-1', {});
    expect(result.summary.totalSpent).toBe('50.00');
    expect(result.summary.currency).toBe('MAD');
    expect(result.items[0]).toMatchObject({
      source: 'MANUAL',
      sourceLabel: 'Manual',
      quantityLabel: '5 piece',
      lastBoxPrice: '10.00',
      editable: true,
    });
  });

  it('maps Figma tab FROM_SHOP to source=SHOP', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findMany.mockResolvedValue([]);
    await service.list('store-1', { tab: 'FROM_SHOP' });
    expect(prisma.merchantPurchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 'store-1',
          source: MerchantPurchaseSource.SHOP,
        }),
      }),
    );
  });
});

describe('PurchasesService.create (manual)', () => {
  it('rejects bundles — purchases are recorded for the products inside them', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue({
      id: 'wp1',
      name: 'Kit',
      kind: 'BUNDLE',
      media: [],
    });

    await expect(
      service.create(ACCESS, {
        warehouseProductId: 'wp1',
        quantity: 1,
        unitPrice: 10,
        purchaseDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a purchase date in the future', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue({
      id: 'wp1',
      name: 'Cable',
      kind: 'STANDARD',
      media: [],
    });
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    await expect(
      service.create(ACCESS, {
        warehouseProductId: 'wp1',
        quantity: 1,
        unitPrice: 10,
        purchaseDate: farFuture,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('computes totalCost from quantity × unitPrice and stamps the group key', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue({
      id: 'wp1',
      name: 'Cable',
      kind: 'STANDARD',
      media: [],
    });
    prisma.merchantPurchase.create.mockResolvedValue({
      source: MerchantPurchaseSource.MANUAL,
      warehouseProductId: 'wp1',
      shopProductId: null,
      productName: 'Cable',
      unitLabel: 'piece',
      imageUrl: null,
      quantity: 3,
      unitPrice: new Prisma.Decimal(12.5),
      totalCost: new Prisma.Decimal(37.5),
      currency: 'MAD',
      purchaseDate: new Date('2026-01-01'),
      notes: null,
      createdAt: new Date(),
    });

    const result = await service.create(ACCESS, {
      warehouseProductId: 'wp1',
      quantity: 3,
      unitPrice: 12.5,
      purchaseDate: '2026-01-01',
    });

    const createCalls = prisma.merchantPurchase.create.mock
      .calls as unknown[][];
    const createArgs = createCalls[0][0] as {
      data: { totalCost: unknown };
    };
    expect(createArgs.data.totalCost).toBeInstanceOf(Prisma.Decimal);
    expect(result.groupKey).toBe('m_wp1');
    expect(result.totalCost).toBe('37.50');
  });
});

describe('PurchasesService editing rules', () => {
  it('refuses to edit or delete a Zomaal Shop purchase', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue({
      id: 'mp1',
      source: MerchantPurchaseSource.SHOP,
    });

    await expect(
      service.update('store-1', 'mp1', { quantity: 5 }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove('store-1', 'mp1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.merchantPurchase.update).not.toHaveBeenCalled();
    expect(prisma.merchantPurchase.delete).not.toHaveBeenCalled();
  });

  it('recomputes totalCost on a manual purchase update', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue({
      id: 'mp1',
      source: MerchantPurchaseSource.MANUAL,
      quantity: 2,
      unitPrice: new Prisma.Decimal(10),
    });
    prisma.merchantPurchase.update.mockResolvedValue({
      source: MerchantPurchaseSource.MANUAL,
      warehouseProductId: 'wp1',
      shopProductId: null,
      productName: 'Cable',
      unitLabel: 'piece',
      imageUrl: null,
      quantity: 4,
      unitPrice: new Prisma.Decimal(10),
      totalCost: new Prisma.Decimal(40),
      currency: 'MAD',
      purchaseDate: new Date(),
      notes: null,
      createdAt: new Date(),
    });

    const result = await service.update('store-1', 'mp1', { quantity: 4 });
    const updateCalls = prisma.merchantPurchase.update.mock
      .calls as unknown[][];
    const updateArgs = updateCalls[0][0] as {
      data: { quantity: unknown; totalCost: unknown };
    };
    expect(updateArgs.data.quantity).toBe(4);
    expect(updateArgs.data.totalCost).toBeInstanceOf(Prisma.Decimal);
    expect(result.totalCost).toBe('40.00');
  });
});

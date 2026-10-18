import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MerchantPurchaseSource, Prisma } from '@prisma/client';
import { PurchasesService } from './purchases.service';

const ACCESS = {
  storeId: 'store-1',
  userId: 'user-1',
  baseCurrency: 'MAD',
} as never;

type Data = Record<string, unknown>;

function purchaseRow(data: Data) {
  return {
    id: 'mp-new',
    source: MerchantPurchaseSource.MANUAL,
    warehouseProductId: null,
    warehouseVariantId: null,
    packagingMaterialId: null,
    shopProductId: null,
    imageUrl: null,
    notes: null,
    stockAdded: false,
    expenseId: null,
    createdAt: new Date('2026-01-02'),
    purchaseDate: new Date('2026-01-01'),
    ...data,
    expense: data.expenseId
      ? { id: data.expenseId, paymentMethod: 'CASH', receiptUrl: null }
      : null,
  };
}

function firstArg(mock: jest.Mock): Data {
  return (mock.mock.calls as Data[][])[0]?.[0];
}

function build() {
  const balance = {
    id: 'bal-1',
    locationId: 'loc-1',
    onHand: 10,
    reserved: 0,
    damaged: 0,
    incoming: 0,
  };
  const findPurchase = jest.fn<Promise<Data | null>, []>();
  const prisma = {
    merchantPurchase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: findPurchase,
      create: jest.fn(({ data }: { data: Data }) =>
        Promise.resolve(purchaseRow(data)),
      ),
      update: jest.fn(async ({ data }: { data: Data }) =>
        purchaseRow({ ...(await findPurchase()), ...data }),
      ),
      delete: jest.fn(),
    },
    warehouseProduct: { findFirst: jest.fn(), findMany: jest.fn() },
    packagingMaterial: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    store: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'MAD' }),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-purchases' }),
      create: jest.fn(),
    },
    expense: {
      create: jest.fn().mockResolvedValue({ id: 'expense-1' }),
      update: jest.fn(),
      delete: jest.fn(),
    },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      upsert: jest.fn().mockResolvedValue({ id: 'inv-new' }),
    },
    inventoryBalance: {
      findFirst: jest.fn().mockResolvedValue(balance),
      update: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(({ data }: { data: Data }) => Promise.resolve(data)),
    },
    warehouseLocation: { upsert: jest.fn() },
  };
  const $transaction = jest.fn((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const media = { deleteAttachedAsset: jest.fn().mockResolvedValue(undefined) };
  const service = new PurchasesService(
    { ...prisma, $transaction } as never,
    media as never,
  );
  return { service, prisma, balance, media };
}

const cable = {
  id: 'wp1',
  name: 'Cable',
  kind: 'STANDARD',
  media: [],
  variants: [{ id: 'var-1', inventoryItem: { id: 'inv-1' } }],
};

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
    expect(shirtGroup?.itemType).toBe('PACKAGING');
  });

  it('reports a single currency total and groups manual packaging by material', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findMany.mockResolvedValue([
      {
        source: MerchantPurchaseSource.MANUAL,
        shopProductId: null,
        warehouseProductId: 'wp1',
        packagingMaterialId: null,
        productName: 'Cable',
        unitLabel: 'piece',
        imageUrl: null,
        quantity: 5,
        unitPrice: new Prisma.Decimal(10),
        totalCost: new Prisma.Decimal(50),
        currency: 'MAD',
        purchaseDate: new Date(),
      },
      {
        source: MerchantPurchaseSource.MANUAL,
        shopProductId: null,
        warehouseProductId: null,
        packagingMaterialId: 'pm1',
        productName: 'Tape',
        unitLabel: 'roll',
        imageUrl: null,
        quantity: 3,
        unitPrice: new Prisma.Decimal(2),
        totalCost: new Prisma.Decimal(6),
        currency: 'MAD',
        purchaseDate: new Date(),
      },
    ]);
    const result = await service.list('store-1', {});
    expect(result.summary.totalSpent).toBe('56.00');
    expect(result.summary.currency).toBe('MAD');
    expect(result.items[0]).toMatchObject({
      key: 'm_wp1',
      itemType: 'PRODUCT',
      sourceLabel: 'Manual',
      quantityLabel: '5 piece',
      lastBoxPrice: '10.00',
      editable: true,
    });
    expect(result.items[1]).toMatchObject({
      key: 'p_pm1',
      itemType: 'PACKAGING',
      quantityLabel: '3 roll',
    });
  });

  it('maps Figma tab FROM_SHOP to source=SHOP', async () => {
    const { service, prisma } = build();
    await service.list('store-1', { tab: 'FROM_SHOP' });
    expect(firstArg(prisma.merchantPurchase.findMany)).toMatchObject({
      where: { storeId: 'store-1', source: MerchantPurchaseSource.SHOP },
    });
  });
});

describe('PurchasesService.create (manual)', () => {
  it('rejects bundles — purchases are recorded for the products inside them', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue({
      ...cable,
      kind: 'BUNDLE',
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
    prisma.warehouseProduct.findFirst.mockResolvedValue(cable);
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

  it('rejects a product and a packaging item together', async () => {
    const { service } = build();
    await expect(
      service.create(ACCESS, {
        warehouseProductId: 'wp1',
        packagingMaterialId: 'pm1',
        quantity: 1,
        unitPrice: 1,
        purchaseDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('asks for the variant when the product has several', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue({
      ...cable,
      variants: [
        { id: 'var-1', inventoryItem: { id: 'inv-1' } },
        { id: 'var-2', inventoryItem: { id: 'inv-2' } },
      ],
    });
    await expect(
      service.create(ACCESS, {
        warehouseProductId: 'wp1',
        quantity: 1,
        unitPrice: 1,
        purchaseDate: '2026-01-01',
      }),
    ).rejects.toThrow(/choose which one/);
  });

  it('records the expense, adds the units to stock and returns the group key', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue(cable);

    const result = await service.create(ACCESS, {
      warehouseProductId: 'wp1',
      quantity: 3,
      unitPrice: 12.5,
      purchaseDate: '2026-01-01',
      paymentMethod: 'BANK',
    });

    expect(firstArg(prisma.expense.create)).toMatchObject({
      data: {
        storeId: 'store-1',
        categoryId: 'cat-purchases',
        title: 'Purchase — Cable',
        amount: new Prisma.Decimal('37.5'),
        paymentMethod: 'BANK',
      },
    });
    expect(firstArg(prisma.merchantPurchase.create)).toMatchObject({
      data: {
        warehouseProductId: 'wp1',
        warehouseVariantId: 'var-1',
        stockAdded: true,
        expenseId: 'expense-1',
        currency: 'MAD',
      },
    });
    expect(firstArg(prisma.inventoryMovement.create)).toMatchObject({
      data: {
        inventoryItemId: 'inv-1',
        type: 'PURCHASE_RECEIVED',
        quantityDelta: 3,
        resultingQuantity: 13,
        referenceType: 'MERCHANT_PURCHASE',
        referenceId: 'mp-new',
      },
    });
    expect(result).toMatchObject({
      groupKey: 'm_wp1',
      itemType: 'PRODUCT',
      totalCost: '37.50',
      stockAdded: true,
      expenseId: 'expense-1',
    });
  });

  it('leaves stock alone when addToStock is off', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findFirst.mockResolvedValue(cable);
    await service.create(ACCESS, {
      warehouseProductId: 'wp1',
      quantity: 3,
      unitPrice: 1,
      purchaseDate: '2026-01-01',
      addToStock: false,
    });
    expect(firstArg(prisma.merchantPurchase.create)).toMatchObject({
      data: { stockAdded: false },
    });
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.expense.create).toHaveBeenCalled();
  });

  it('buys packaging into its own stock, with its unit and the receipt on the expense', async () => {
    const { service, prisma } = build();
    prisma.packagingMaterial.findFirst.mockResolvedValue({
      id: 'pm1',
      name: 'Tape',
      unit: 'ROLLS',
      imageObjectName: null,
      inventoryItem: null,
    });

    const result = await service.create(ACCESS, {
      packagingMaterialId: 'pm1',
      quantity: 4,
      unitPrice: 2,
      purchaseDate: '2026-01-01',
      receiptAssetId: 'receipt-1',
    });

    expect(firstArg(prisma.mediaAsset.updateMany)).toMatchObject({
      where: { id: 'receipt-1', storeId: 'store-1', purpose: 'RECEIPT' },
      data: { expenseId: 'expense-1' },
    });
    expect(firstArg(prisma.inventoryItem.upsert)).toMatchObject({
      where: { packagingMaterialId: 'pm1' },
    });
    expect(firstArg(prisma.inventoryMovement.create)).toMatchObject({
      data: { inventoryItemId: 'inv-new', quantityDelta: 4 },
    });
    expect(result).toMatchObject({
      groupKey: 'p_pm1',
      itemType: 'PACKAGING',
      unitLabel: 'roll',
      quantityLabel: '4 roll',
    });
  });
});

describe('PurchasesService editing rules', () => {
  const manual = {
    id: 'mp1',
    storeId: 'store-1',
    source: MerchantPurchaseSource.MANUAL,
    warehouseProductId: 'wp1',
    warehouseVariantId: 'var-1',
    packagingMaterialId: null,
    productName: 'Cable',
    unitLabel: 'piece',
    quantity: 2,
    unitPrice: new Prisma.Decimal(10),
    purchaseDate: new Date('2026-01-01'),
    notes: null,
    stockAdded: true,
    expenseId: 'expense-1',
    createdByUserId: 'user-1',
    currency: 'MAD',
  };

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

  it('moves stock by the difference and keeps the expense in step', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue(manual);

    const result = await service.update('store-1', 'mp1', { quantity: 4 });

    expect(firstArg(prisma.inventoryMovement.create)).toMatchObject({
      data: { inventoryItemId: 'inv-1', quantityDelta: 2 },
    });
    expect(firstArg(prisma.expense.update)).toMatchObject({
      where: { id: 'expense-1' },
      data: { amount: new Prisma.Decimal(40) },
    });
    expect(result.totalCost).toBe('40.00');
  });

  it('refuses to reduce a purchase whose stock is already reserved', async () => {
    const { service, prisma, balance } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue(manual);
    balance.onHand = 2;
    balance.reserved = 2;
    await expect(
      service.update('store-1', 'mp1', { quantity: 1 }),
    ).rejects.toThrow(ConflictException);
    await expect(service.remove('store-1', 'mp1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('deleting removes the stock it added, its expense and receipt', async () => {
    const { service, prisma, media } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue(manual);
    prisma.mediaAsset.findUnique.mockResolvedValue({ id: 'receipt-1' });

    await service.remove('store-1', 'mp1');

    expect(firstArg(prisma.inventoryMovement.create)).toMatchObject({
      data: { quantityDelta: -2, resultingQuantity: 8 },
    });
    expect(prisma.merchantPurchase.delete).toHaveBeenCalledWith({
      where: { id: 'mp1' },
    });
    expect(prisma.expense.delete).toHaveBeenCalledWith({
      where: { id: 'expense-1' },
    });
    expect(media.deleteAttachedAsset).toHaveBeenCalledWith('receipt-1');
  });

  it('does not touch stock for purchases recorded without it', async () => {
    const { service, prisma } = build();
    prisma.merchantPurchase.findFirst.mockResolvedValue({
      ...manual,
      stockAdded: false,
    });
    await service.update('store-1', 'mp1', { quantity: 9 });
    await service.remove('store-1', 'mp1');
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

describe('PurchasesService.productOptions', () => {
  it('lists products with variants and packaging with its unit', async () => {
    const { service, prisma } = build();
    prisma.warehouseProduct.findMany.mockResolvedValue([
      {
        id: 'wp1',
        name: 'Cable',
        media: [],
        variants: [
          {
            id: 'var-1',
            title: 'Default',
            price: new Prisma.Decimal(20),
            costPrice: new Prisma.Decimal(8),
            inventoryItem: {
              balances: [{ onHand: 5, reserved: 1, damaged: 0 }],
            },
          },
        ],
      },
    ]);
    prisma.packagingMaterial.findMany.mockResolvedValue([
      {
        id: 'pm1',
        name: 'Box',
        unit: 'PIECES',
        imageObjectName: null,
        inventoryItem: null,
      },
    ]);

    const options = await service.productOptions('store-1');

    expect(options.map((o) => [o.itemType, o.name])).toEqual([
      ['PACKAGING', 'Box'],
      ['PRODUCT', 'Cable'],
    ]);
    expect(options[1]).toMatchObject({
      stock: 4,
      costPrice: '8.00',
      variants: [{ id: 'var-1', stock: 4 }],
    });
    expect(options[0]).toMatchObject({ unit: 'PIECES', stock: 0 });
  });

  it('filters by type', async () => {
    const { service, prisma } = build();
    await service.productOptions('store-1', undefined, 'PACKAGING');
    expect(prisma.warehouseProduct.findMany).not.toHaveBeenCalled();
  });
});

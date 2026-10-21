import {
  InventoryItemKind,
  Prisma,
  WarehouseProductKind,
} from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { ItemValueService } from './item-value.service';
import { WarehouseStoreService } from './warehouse-store.service';

const D = (value: string) => new Prisma.Decimal(value);

function product(
  id: string,
  cost: string,
  balances: Array<{ onHand: number; reserved: number; damaged: number }>,
  kind = WarehouseProductKind.STANDARD,
) {
  return {
    id,
    kind: InventoryItemKind.PRODUCT_VARIANT,
    variant: {
      id: `${id}-variant`,
      title: 'Default',
      sku: id,
      costPrice: D(cost),
      product: { name: id, kind },
    },
    packagingMaterial: null,
    balances,
  };
}

function packaging(id: string, key: string | null, onHand: number) {
  return {
    id,
    kind: InventoryItemKind.PACKAGING_MATERIAL,
    variant: null,
    packagingMaterial: {
      id: `${id}-material`,
      name: id,
      sku: id,
      zomaalShopVariantId: key,
    },
    balances: [{ onHand, reserved: 0, damaged: 0 }],
  };
}

describe('ItemValueService', () => {
  const items = jest.fn();
  const purchases = jest.fn();
  const convert = jest.fn();
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      inventoryItem: { findMany: items },
      $queryRaw: purchases,
    }),
  );
  const service = new ItemValueService(
    { $transaction: transaction } as unknown as PrismaService,
    {
      requireStore: jest
        .fn()
        .mockResolvedValue({ id: 'store-a', baseCurrency: 'MAD' }),
    } as unknown as WarehouseStoreService,
    { convertOrNull: convert } as unknown as CurrencyService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('values physical stock across locations, separates reserved/damaged, and never adds virtual bundles', async () => {
    items.mockResolvedValue([
      product('product-a', '12.50', [
        { onHand: 5, reserved: 1, damaged: 1 },
        { onHand: 3, reserved: 0, damaged: 0 },
      ]),
      product(
        'bundle-a',
        '50',
        [{ onHand: 2, reserved: 0, damaged: 0 }],
        WarehouseProductKind.BUNDLE,
      ),
      product('import-no-cost', '0', [{ onHand: 4, reserved: 0, damaged: 0 }]),
      packaging('box-a', null, 6),
    ]);
    purchases.mockResolvedValue([
      {
        packagingMaterialId: 'box-a-material',
        totalCost: D('18'),
        quantity: 6,
        currency: 'MAD',
        shopOrderItem: null,
      },
    ]);

    const result = await service.get('owner-a', { page: 1, limit: 2 });

    const itemCalls = items.mock.calls as unknown as Array<
      [Prisma.InventoryItemFindManyArgs]
    >;
    expect(itemCalls[0][0].where?.storeId).toBe('store-a');
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.summary).toMatchObject({
      currency: 'MAD',
      itemCount: 3,
      onHandUnits: 18,
      availableUnits: 16,
      reservedUnits: 1,
      damagedUnits: 1,
      knownOnHandValue: '118.00',
      knownAvailableValue: '93.00',
      knownReservedValue: '12.50',
      knownDamagedValue: '12.50',
      unvaluedItemCount: 1,
      unvaluedOnHandUnits: 4,
      complete: false,
    });
    expect(result.items.find((row) => row.name === 'box-a')).toMatchObject({
      unitCost: '3.0000',
      onHandValue: '18.00',
    });
  });

  it('uses the latest linked shop purchase and never invents an exchange rate', async () => {
    items.mockResolvedValue([packaging('shop-box', 'catalog-variant', 5)]);
    purchases.mockResolvedValue([
      {
        packagingMaterialId: 'shop-box-material',
        totalCost: D('20'),
        quantity: 2,
        currency: 'EUR',
        shopOrderItem: {
          variantId: 'catalog-variant',
          productId: 'catalog-product',
        },
      },
    ]);
    convert.mockResolvedValue(null);

    const result = await service.get('owner-a', {});

    expect(result.items[0]).toMatchObject({
      unitCost: null,
      onHandValue: null,
    });
    expect(result.summary).toMatchObject({
      knownOnHandValue: '0.00',
      unvaluedOnHandUnits: 5,
      complete: false,
    });
    const purchaseCalls = purchases.mock.calls as unknown as Array<
      [Prisma.Sql]
    >;
    expect(purchaseCalls[0][0].values).toContain('store-a');
  });

  it('returns an empty, complete valuation when the store has no on-hand stock', async () => {
    items.mockResolvedValue([]);

    const result = await service.get('owner-a', {});

    expect(purchases).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      summary: {
        itemCount: 0,
        onHandUnits: 0,
        knownOnHandValue: '0.00',
        unvaluedItemCount: 0,
        complete: true,
      },
    });
  });

  it('converts a purchased packaging cost and keeps the summary across pages', async () => {
    items.mockResolvedValue([
      packaging('box-a', 'catalog-variant', 4),
      product('product-a', '2.00', [{ onHand: 3, reserved: 0, damaged: 0 }]),
    ]);
    purchases.mockResolvedValue([
      {
        packagingMaterialId: 'box-a-material',
        totalCost: D('10'),
        quantity: 2,
        currency: 'EUR',
        shopOrderItem: {
          variantId: 'catalog-variant',
          productId: 'catalog-product',
        },
      },
    ]);
    convert.mockResolvedValue(D('11'));

    const result = await service.get('owner-a', { page: 2, limit: 1 });

    const itemCalls = items.mock.calls as unknown as Array<
      [Prisma.InventoryItemFindManyArgs]
    >;
    expect(itemCalls[0][0].where?.storeId).toBe('store-a');
    expect(convert).toHaveBeenCalledWith(D('1'), 'EUR', 'MAD');
    expect(result).toMatchObject({
      items: [{ id: 'product-a' }],
      total: 2,
      page: 2,
      limit: 1,
      summary: { knownOnHandValue: '226.00', complete: true },
    });
  });

  it('reports a confirmed free packaging purchase as known zero without an exchange quote', async () => {
    items.mockResolvedValue([packaging('free-box', null, 4)]);
    purchases.mockResolvedValue([
      {
        packagingMaterialId: 'free-box-material',
        totalCost: D('0'),
        quantity: 4,
        currency: 'EUR',
        shopOrderItem: null,
      },
    ]);
    const result = await service.get('owner-a', {});
    expect(convert).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      unitCost: '0.0000',
      onHandValue: '0.00',
    });
    expect(result.summary).toMatchObject({
      complete: true,
      unvaluedItemCount: 0,
    });
  });

  it('reports an invalid latest purchase quantity as unknown', async () => {
    items.mockResolvedValue([packaging('box', null, 2)]);
    purchases.mockResolvedValue([
      {
        packagingMaterialId: 'box-material',
        totalCost: D('10'),
        quantity: 0,
        currency: 'MAD',
        shopOrderItem: null,
      },
    ]);
    const result = await service.get('owner-a', {});
    expect(result.items[0].unitCost).toBeNull();
    expect(result.summary.complete).toBe(false);
  });

  it.each(['-1', '0', 'NaN'])(
    'does not use invalid FX quote %s to manufacture a valuation',
    async (rate) => {
      items.mockResolvedValue([packaging('box', null, 2)]);
      purchases.mockResolvedValue([
        {
          packagingMaterialId: 'box-material',
          totalCost: D('10'),
          quantity: 2,
          currency: 'EUR',
        },
      ]);
      convert.mockResolvedValue(D(rate));
      const result = await service.get('owner-a', {});
      expect(result.items[0].unitCost).toBeNull();
      expect(result.summary.complete).toBe(false);
    },
  );

  it('uses one FX quote per currency and never converts product costs twice', async () => {
    items.mockResolvedValue([
      packaging('a', null, 3),
      packaging('b', null, 4),
      product('c', '5', [{ onHand: 2, reserved: 1, damaged: 0 }]),
    ]);
    purchases.mockResolvedValue(
      ['a', 'b'].map((id) => ({
        packagingMaterialId: id + '-material',
        totalCost: D('9'),
        quantity: 3,
        currency: 'EUR',
        shopOrderItem: null,
      })),
    );
    convert.mockResolvedValue(D('10'));
    const result = await service.get('owner-a', {});
    expect(convert).toHaveBeenCalledTimes(1);
    expect(result.summary.knownOnHandValue).toBe('220.00');
    expect(result.items.find((x) => x.id === 'c')?.unitCost).toBe('5.0000');
  });
});

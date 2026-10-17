import { InventoryBucket, InventoryMovementType, Prisma } from '@prisma/client';
import { ProductCondition } from './constants/product-condition';
import {
  clampDelta,
  conditionEffects,
  expandOrderLine,
  orderLineCosts,
  packagingFor,
  type OrderLineWithStock,
} from './order-stock.util';

function physical(itemId: string | null, components?: [string, number][]) {
  return {
    costPrice: null,
    inventoryItem: itemId ? { id: itemId } : null,
    product: {
      kind: components ? 'BUNDLE' : 'STANDARD',
      bundleComponents: (components ?? []).map(([id, quantity]) => ({
        quantity,
        componentVariant: { inventoryItem: { id } },
      })),
    },
  };
}

function line(
  quantity: number,
  variant: ReturnType<typeof physical> & {
    gift?: { quantity: number; giftVariant: ReturnType<typeof physical> };
    packaging?: {
      variantId: string | null;
      materialId: string;
      itemId: string;
      perUnit: number;
    }[];
  },
): OrderLineWithStock {
  return {
    id: 'line-1',
    quantity,
    warehouseVariant: {
      id: 'variant-1',
      costPrice: null,
      inventoryItem: variant.inventoryItem,
      product: {
        ...variant.product,
        gift: variant.gift ?? null,
        packagingRequirements: (variant.packaging ?? []).map((p) => ({
          variantId: p.variantId,
          quantityPerUnit: p.perUnit,
          packagingMaterialId: p.materialId,
          packagingMaterial: { inventoryItem: { id: p.itemId } },
        })),
      },
    },
  } as unknown as OrderLineWithStock;
}

describe('expandOrderLine', () => {
  it('scales product, gift and packaging by the ordered quantity', () => {
    const units = expandOrderLine(
      line(2, {
        ...physical('item-product'),
        gift: { quantity: 1, giftVariant: physical('item-gift') },
        packaging: [
          {
            variantId: null,
            materialId: 'box',
            itemId: 'item-box',
            perUnit: 1,
          },
        ],
      }),
    );
    expect(units).toEqual([
      { inventoryItemId: 'item-product', quantity: 2, role: 'PRODUCT' },
      { inventoryItemId: 'item-gift', quantity: 2, role: 'GIFT' },
      { inventoryItemId: 'item-box', quantity: 2, role: 'PACKAGING' },
    ]);
  });

  it('expands a bundle (pack code) into its components', () => {
    const units = expandOrderLine(
      line(
        3,
        physical(null, [
          ['item-a', 1],
          ['item-b', 2],
        ]),
      ),
    );
    expect(units).toEqual([
      { inventoryItemId: 'item-a', quantity: 3, role: 'PRODUCT' },
      { inventoryItemId: 'item-b', quantity: 6, role: 'PRODUCT' },
    ]);
  });

  it('consumes nothing for unmatched lines', () => {
    expect(
      expandOrderLine({
        id: 'line-1',
        quantity: 1,
        warehouseVariant: null,
      } as unknown as OrderLineWithStock),
    ).toEqual([]);
  });
});

describe('orderLineCosts', () => {
  it('prices product, gift and packaging for the ordered quantity', () => {
    const costedLine = line(3, {
      ...physical('item-product'),
      gift: { quantity: 2, giftVariant: physical('item-gift') },
      packaging: [
        { variantId: null, materialId: 'box', itemId: 'item-box', perUnit: 1 },
        {
          variantId: null,
          materialId: 'tape',
          itemId: 'item-tape',
          perUnit: 2,
        },
      ],
    });
    costedLine.warehouseVariant!.costPrice = new Prisma.Decimal(40);
    costedLine.warehouseVariant!.product.gift!.giftVariant.costPrice =
      new Prisma.Decimal(5);

    const costs = orderLineCosts(
      costedLine,
      new Map([['box', new Prisma.Decimal('3.5')]]),
    );

    expect(costs.productCost.toFixed(2)).toBe('120.00');
    expect(costs.giftCost.toFixed(2)).toBe('30.00');
    // Tape has no known price, so it costs 0 rather than an invented amount.
    expect(costs.packagingCost.toFixed(2)).toBe('10.50');
  });
});

describe('packagingFor', () => {
  it('lets a variant rule override the product rule for the same material', () => {
    const rules = [
      { variantId: null, packagingMaterialId: 'box', tag: 'product-box' },
      {
        variantId: 'variant-1',
        packagingMaterialId: 'box',
        tag: 'variant-box',
      },
      { variantId: null, packagingMaterialId: 'tape', tag: 'product-tape' },
      { variantId: 'variant-2', packagingMaterialId: 'bag', tag: 'other' },
    ];
    expect(packagingFor('variant-1', rules).map((r) => r.tag)).toEqual([
      'variant-box',
      'product-tape',
    ]);
  });
});

describe('clampDelta', () => {
  const balance = { onHand: 10, reserved: 6, damaged: 1, incoming: 0 };

  it('caps reservations and damage at available stock', () => {
    expect(clampDelta(balance, InventoryBucket.RESERVED, 5)).toBe(3);
    expect(clampDelta(balance, InventoryBucket.DAMAGED, 2)).toBe(2);
  });

  it('never lets on-hand drop below what is reserved or damaged', () => {
    expect(clampDelta(balance, InventoryBucket.ON_HAND, -5)).toBe(-3);
  });

  it('caps releases at the bucket and leaves restocks unclamped', () => {
    expect(clampDelta(balance, InventoryBucket.RESERVED, -9)).toBe(-6);
    expect(clampDelta(balance, InventoryBucket.ON_HAND, 4)).toBe(4);
  });
});

describe('conditionEffects', () => {
  it('restocks a delivered good return but not an undelivered one', () => {
    expect(conditionEffects(ProductCondition.GOOD, true)).toEqual([
      {
        type: InventoryMovementType.RETURN_GOOD,
        bucket: InventoryBucket.ON_HAND,
        sign: 1,
      },
    ]);
    expect(conditionEffects(ProductCondition.GOOD, false)).toEqual([]);
  });

  it('brings a delivered damaged unit back into on-hand as damaged', () => {
    expect(
      conditionEffects(ProductCondition.DAMAGED, true).map((e) => e.bucket),
    ).toEqual([InventoryBucket.ON_HAND, InventoryBucket.DAMAGED]);
    expect(
      conditionEffects(ProductCondition.DAMAGED, false).map((e) => e.bucket),
    ).toEqual([InventoryBucket.DAMAGED]);
  });

  it('writes off an undelivered lost unit only', () => {
    expect(conditionEffects(ProductCondition.LOST, true)).toEqual([]);
    expect(conditionEffects(ProductCondition.MISSING, false)).toEqual([
      {
        type: InventoryMovementType.RETURN_LOST,
        bucket: InventoryBucket.ON_HAND,
        sign: -1,
      },
    ]);
  });
});

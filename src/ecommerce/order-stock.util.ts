import {
  InventoryBucket,
  InventoryMovementType,
  Prisma,
  WarehouseProductKind,
} from '@prisma/client';
import { ProductCondition } from './constants/product-condition';
import {
  availableQuantity,
  bucketField,
  type BalanceQuantities,
} from '../warehouse/inventory-balance.util';

const PHYSICAL_VARIANT_SELECT = {
  costPrice: true,
  inventoryItem: { select: { id: true } },
  product: {
    select: {
      kind: true,
      bundleComponents: {
        select: {
          quantity: true,
          componentVariant: {
            select: { inventoryItem: { select: { id: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.WarehouseVariantSelect;

export const ORDER_LINE_STOCK_INCLUDE = {
  warehouseVariant: {
    select: {
      id: true,
      ...PHYSICAL_VARIANT_SELECT,
      product: {
        select: {
          ...PHYSICAL_VARIANT_SELECT.product.select,
          gift: {
            select: {
              quantity: true,
              giftVariant: { select: PHYSICAL_VARIANT_SELECT },
            },
          },
          packagingRequirements: {
            select: {
              variantId: true,
              quantityPerUnit: true,
              packagingMaterialId: true,
              packagingMaterial: {
                select: { inventoryItem: { select: { id: true } } },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.EcommerceOrderLineInclude;

export type OrderLineWithStock = Prisma.EcommerceOrderLineGetPayload<{
  include: typeof ORDER_LINE_STOCK_INCLUDE;
}>;

export type StockRole = 'PRODUCT' | 'GIFT' | 'PACKAGING';

export interface StockUnit {
  inventoryItemId: string;
  quantity: number;
  role: StockRole;
}

type PhysicalVariant = Prisma.WarehouseVariantGetPayload<{
  select: typeof PHYSICAL_VARIANT_SELECT;
}>;

/**
 * The inventory items an order line physically consumes: the product (or a
 * bundle's components), its gift, and its packaging — each scaled by the
 * ordered quantity. Lines not matched to a warehouse product consume nothing.
 */
export function expandOrderLine(line: OrderLineWithStock): StockUnit[] {
  const variant = line.warehouseVariant;
  if (!variant || line.quantity <= 0) return [];

  const units: StockUnit[] = [];
  const add = (
    inventoryItemId: string | undefined,
    quantity: number,
    role: StockRole,
  ) => {
    if (!inventoryItemId || quantity <= 0) return;
    const existing = units.find(
      (unit) => unit.inventoryItemId === inventoryItemId && unit.role === role,
    );
    if (existing) existing.quantity += quantity;
    else units.push({ inventoryItemId, quantity, role });
  };
  const addPhysical = (
    physical: PhysicalVariant,
    quantity: number,
    role: StockRole,
  ) => {
    if (physical.product.kind === WarehouseProductKind.BUNDLE) {
      for (const component of physical.product.bundleComponents) {
        add(
          component.componentVariant.inventoryItem?.id,
          component.quantity * quantity,
          role,
        );
      }
    } else {
      add(physical.inventoryItem?.id, quantity, role);
    }
  };

  addPhysical(variant, line.quantity, 'PRODUCT');
  const gift = variant.product.gift;
  if (gift)
    addPhysical(gift.giftVariant, gift.quantity * line.quantity, 'GIFT');
  for (const requirement of packagingFor(
    variant.id,
    variant.product.packagingRequirements,
  )) {
    add(
      requirement.packagingMaterial.inventoryItem?.id,
      requirement.quantityPerUnit * line.quantity,
      'PACKAGING',
    );
  }
  return units;
}

export interface OrderLineCosts {
  productCost: Prisma.Decimal;
  giftCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
}

type CostedLine = {
  quantity: number;
  warehouseVariant: NonNullable<OrderLineWithStock['warehouseVariant']> | null;
};

/**
 * Cost of goods for one delivered line: product, its gift, and the packaging
 * it consumes. Unmatched lines and materials without a known price cost 0,
 * so profit is understated rather than invented.
 */
export function orderLineCosts(
  line: CostedLine,
  packagingUnitCosts: Map<string, Prisma.Decimal>,
): OrderLineCosts {
  const zero = new Prisma.Decimal(0);
  const variant = line.warehouseVariant;
  if (!variant || line.quantity <= 0) {
    return { productCost: zero, giftCost: zero, packagingCost: zero };
  }
  const gift = variant.product.gift;
  const packagingCost = packagingFor(
    variant.id,
    variant.product.packagingRequirements,
  ).reduce(
    (sum, requirement) =>
      sum.plus(
        (packagingUnitCosts.get(requirement.packagingMaterialId) ?? zero).times(
          requirement.quantityPerUnit * line.quantity,
        ),
      ),
    zero,
  );
  return {
    productCost: variant.costPrice.times(line.quantity),
    giftCost: gift
      ? gift.giftVariant.costPrice.times(gift.quantity * line.quantity)
      : zero,
    packagingCost,
  };
}

/** Packaging materials whose unit cost is needed to cost these lines. */
export function packagingMaterialIds(lines: CostedLine[]): string[] {
  return lines.flatMap((line) =>
    line.warehouseVariant
      ? packagingFor(
          line.warehouseVariant.id,
          line.warehouseVariant.product.packagingRequirements,
        ).map((requirement) => requirement.packagingMaterialId)
      : [],
  );
}

/** Variant-specific packaging rules override product-level ones per material. */
export function packagingFor<
  T extends { variantId: string | null; packagingMaterialId: string },
>(variantId: string, requirements: T[]): T[] {
  const specific = requirements.filter((r) => r.variantId === variantId);
  const overridden = new Set(specific.map((r) => r.packagingMaterialId));
  return [
    ...specific,
    ...requirements.filter(
      (r) => r.variantId === null && !overridden.has(r.packagingMaterialId),
    ),
  ];
}

/**
 * The largest part of `delta` that keeps the balance valid (nothing negative,
 * reserved + damaged ≤ on hand). Order flows never fail because the merchant
 * did not track stock — they move what is there.
 */
export function clampDelta(
  balance: BalanceQuantities,
  bucket: InventoryBucket,
  delta: number,
): number {
  const available = Math.max(availableQuantity(balance), 0);
  if (delta > 0) {
    return bucket === InventoryBucket.RESERVED ||
      bucket === InventoryBucket.DAMAGED
      ? Math.min(delta, available)
      : delta;
  }
  const reducible =
    bucket === InventoryBucket.ON_HAND
      ? available
      : Math.max(balance[bucketField(bucket)], 0);
  return -Math.min(-delta, reducible);
}

export interface ConditionEffect {
  type: InventoryMovementType;
  bucket: InventoryBucket;
  sign: 1 | -1;
}

/**
 * Stock effect of a returned unit's condition. A delivered unit was already
 * deducted, so it comes back into stock; an undelivered unit never left the
 * books, so only damage or loss changes anything.
 */
export function conditionEffects(
  condition: ProductCondition,
  delivered: boolean,
): ConditionEffect[] {
  const good = {
    type: InventoryMovementType.RETURN_GOOD,
    bucket: InventoryBucket.ON_HAND,
    sign: 1,
  } as const;
  const damaged = {
    type: InventoryMovementType.RETURN_DAMAGED,
    bucket: InventoryBucket.DAMAGED,
    sign: 1,
  } as const;
  switch (condition) {
    case ProductCondition.GOOD:
    case ProductCondition.RETURNED:
      return delivered ? [good] : [];
    case ProductCondition.DAMAGED:
      return delivered
        ? [{ ...good, type: InventoryMovementType.RETURN_DAMAGED }, damaged]
        : [damaged];
    case ProductCondition.LOST:
    case ProductCondition.MISSING:
      return delivered
        ? []
        : [
            {
              type: InventoryMovementType.RETURN_LOST,
              bucket: InventoryBucket.ON_HAND,
              sign: -1,
            },
          ];
  }
}

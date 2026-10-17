import { Prisma } from '@prisma/client';
import { ProductCondition } from './constants/product-condition';

/**
 * Loss for one returned order line, at cost price (client rule): Lost and
 * Missing lose the purchase cost, Damaged loses the recorded damage cost or
 * the purchase cost when none was entered, Good and Returned lose nothing.
 * Lines not linked to a Zomaal product have no known cost, so only an
 * explicit damage cost counts for them.
 */
export function conditionLoss(line: {
  condition: string | null;
  damageCost: Prisma.Decimal | null;
  quantity: number;
  warehouseVariant?: { costPrice: Prisma.Decimal } | null;
}): Prisma.Decimal {
  const zero = new Prisma.Decimal(0);
  const cost = line.warehouseVariant
    ? line.warehouseVariant.costPrice.times(line.quantity)
    : zero;
  switch (line.condition) {
    case ProductCondition.DAMAGED:
      return line.damageCost ?? cost;
    case ProductCondition.LOST:
    case ProductCondition.MISSING:
      return cost;
    default:
      return zero;
  }
}

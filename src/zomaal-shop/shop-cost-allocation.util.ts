import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertPersistedMoney } from '../common/persisted-money';

const Precise = Prisma.Decimal.clone({ precision: 60 });

/** Allocate the amount actually paid (discount + delivery included) to items.
 * Largest remainder in cents preserves the exact total; id breaks ties.
 * Zero-priced baskets allocate any delivery cost by physical quantity.
 */
export function allocateShopCosts(
  items: { id: string; quantity: number; lineTotal: Prisma.Decimal }[],
  total: Prisma.Decimal,
): Map<string, Prisma.Decimal> {
  assertPersistedMoney(total, 'Purchase cost');
  if (!items.length) {
    if (!total.isZero()) throw new BadRequestException('Order has no items');
    return new Map();
  }
  const gross = items.reduce(
    (sum, item) => sum.plus(item.lineTotal),
    new Precise(0),
  );
  const weights = items.map((item) =>
    gross.isZero() ? new Precise(item.quantity) : new Precise(item.lineTotal),
  );
  const weightTotal = weights.reduce(
    (sum, weight) => sum.plus(weight),
    new Precise(0),
  );
  const cents = new Precise(total).toDecimalPlaces(2).times(100);
  const rows = items.map((item, index) => {
    const exact = cents.times(weights[index]).dividedBy(weightTotal);
    const floor = exact.floor();
    return { id: item.id, cents: floor, remainder: exact.minus(floor) };
  });
  const left = cents
    .minus(rows.reduce((sum, row) => sum.plus(row.cents), new Precise(0)))
    .toNumber();
  rows.sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.id.localeCompare(b.id),
  );
  for (let index = 0; index < left; index++)
    rows[index].cents = rows[index].cents.plus(1);
  return new Map(
    rows.map((row) => [
      row.id,
      new Prisma.Decimal(row.cents.dividedBy(100).toString()),
    ]),
  );
}

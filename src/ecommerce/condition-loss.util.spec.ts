import { Prisma } from '@prisma/client';
import { conditionLoss } from './condition-loss.util';

const linked = { costPrice: new Prisma.Decimal('40.00') };

function loss(
  condition: string | null,
  extras: {
    damageCost?: string;
    quantity?: number;
    warehouseVariant?: typeof linked | null;
  } = {},
) {
  return conditionLoss({
    condition,
    damageCost: extras.damageCost
      ? new Prisma.Decimal(extras.damageCost)
      : null,
    quantity: extras.quantity ?? 2,
    warehouseVariant:
      extras.warehouseVariant === undefined ? linked : extras.warehouseVariant,
  }).toFixed(2);
}

describe('conditionLoss', () => {
  it('loses the purchase cost for lost and missing units', () => {
    expect(loss('LOST')).toBe('80.00');
    expect(loss('MISSING')).toBe('80.00');
  });

  it('uses the damage cost when entered, otherwise the purchase cost', () => {
    expect(loss('DAMAGED', { damageCost: '15.00' })).toBe('15.00');
    expect(loss('DAMAGED')).toBe('80.00');
  });

  it('loses nothing for good or returned units', () => {
    expect(loss('GOOD')).toBe('0.00');
    expect(loss('RETURNED')).toBe('0.00');
    expect(loss(null)).toBe('0.00');
  });

  it('never invents a cost for lines not linked to a Zomaal product', () => {
    expect(loss('LOST', { warehouseVariant: null })).toBe('0.00');
    expect(
      loss('DAMAGED', { warehouseVariant: null, damageCost: '25.00' }),
    ).toBe('25.00');
  });
});

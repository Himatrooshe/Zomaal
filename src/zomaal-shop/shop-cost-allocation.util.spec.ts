import { Prisma } from '@prisma/client';
import { allocateShopCosts } from './shop-cost-allocation.util';
const D = (value: string | number) => new Prisma.Decimal(value);
describe('Shop delivered acquisition cost allocation', () => {
  it('assigns rounding cents deterministically and preserves the exact paid total', () => {
    const items = ['c', 'a', 'b'].map((id) => ({
      id,
      quantity: 1,
      lineTotal: D(1),
    }));
    const result = allocateShopCosts(items, D('0.02'));
    expect(result.get('a')!.toFixed(2)).toBe('0.01');
    expect(result.get('b')!.toFixed(2)).toBe('0.01');
    expect(result.get('c')!.toFixed(2)).toBe('0.00');
  });
  it('allocates delivery for free products by quantity', () => {
    const result = allocateShopCosts(
      [
        { id: 'a', quantity: 1, lineTotal: D(0) },
        { id: 'b', quantity: 3, lineTotal: D(0) },
      ],
      D(2),
    );
    expect(result.get('a')!.toFixed(2)).toBe('0.50');
    expect(result.get('b')!.toFixed(2)).toBe('1.50');
  });
  it('keeps exact cents close to the monetary persistence boundary', () => {
    const total = D('9999999999999999.97');
    const result = allocateShopCosts(
      ['a', 'b', 'c'].map((id) => ({
        id,
        quantity: 1,
        lineTotal: D('3333333333333333.33'),
      })),
      total,
    );
    expect(
      [...result.values()]
        .reduce((sum, cost) => sum.plus(cost), D(0))
        .equals(total),
    ).toBe(true);
    expect(result.get('a')!.toFixed(2)).toBe('3333333333333333.33');
    expect(result.get('b')!.toFixed(2)).toBe('3333333333333333.32');
  });
  it('rejects an unpersistable total and inconsistent nonempty monetary amount', () => {
    expect(() => allocateShopCosts([], D(1))).toThrow('no items');
    expect(() =>
      allocateShopCosts([{ id: 'a', quantity: 1, lineTotal: D(1) }], D('1e16')),
    ).toThrow('range');
  });
});

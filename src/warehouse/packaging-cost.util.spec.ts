import { Prisma } from '@prisma/client';
import { resolvePackagingUnitCosts } from './packaging-cost.util';

describe('resolvePackagingUnitCosts', () => {
  it('leaves merchant-added packaging out (cost 0) without querying the shop', async () => {
    const db = {
      packagingMaterial: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'manual', storeId: 'store-1', zomaalShopVariantId: null },
          { id: 'shop', storeId: 'store-1', zomaalShopVariantId: 'variant-1' },
        ]),
      },
      merchantPurchase: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ unitPrice: new Prisma.Decimal('2.5') }),
      },
      shopProductVariant: { findUnique: jest.fn() },
      shopProduct: { findUnique: jest.fn() },
    };

    const costs = await resolvePackagingUnitCosts(db as never, [
      'manual',
      'shop',
    ]);

    expect(costs.has('manual')).toBe(false);
    expect(costs.get('shop')?.toFixed(2)).toBe('2.50');
    expect(db.merchantPurchase.findFirst).toHaveBeenCalledTimes(1);
  });
});

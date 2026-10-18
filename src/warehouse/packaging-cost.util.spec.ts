import { Prisma } from '@prisma/client';
import { resolvePackagingUnitCosts } from './packaging-cost.util';

function build(lastPaid: Record<string, string | undefined>) {
  return {
    packagingMaterial: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'manual', storeId: 'store-1', zomaalShopVariantId: null },
        { id: 'shop', storeId: 'store-1', zomaalShopVariantId: 'variant-1' },
      ]),
    },
    merchantPurchase: {
      findFirst: jest.fn(
        ({ where }: { where: { OR: [{ packagingMaterialId: string }] } }) => {
          const price = lastPaid[where.OR[0].packagingMaterialId];
          return Promise.resolve(
            price ? { unitPrice: new Prisma.Decimal(price) } : null,
          );
        },
      ),
    },
    shopProductVariant: {
      findUnique: jest.fn().mockResolvedValue({
        price: new Prisma.Decimal('4'),
        product: { price: null },
      }),
    },
    shopProduct: { findUnique: jest.fn() },
  };
}

describe('resolvePackagingUnitCosts', () => {
  it('uses the last price paid, manual or from the shop', async () => {
    const db = build({ manual: '1.2', shop: '2.5' });
    const costs = await resolvePackagingUnitCosts(db as never, [
      'manual',
      'shop',
    ]);
    expect(costs.get('manual')?.toFixed(2)).toBe('1.20');
    expect(costs.get('shop')?.toFixed(2)).toBe('2.50');
    expect(db.shopProductVariant.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the shop price for shop packaging, and leaves never-bought merchant packaging out', async () => {
    const db = build({});
    const costs = await resolvePackagingUnitCosts(db as never, [
      'manual',
      'shop',
    ]);
    expect(costs.has('manual')).toBe(false);
    expect(costs.get('shop')?.toFixed(2)).toBe('4.00');
  });
});

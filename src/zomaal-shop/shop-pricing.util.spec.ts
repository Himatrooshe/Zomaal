import { Prisma, ShopPromoType } from '@prisma/client';
import {
  checkPromo,
  effectivePrice,
  priceOrder,
  type PromoInput,
} from './shop-pricing.util';

const D = (v: number | string) => new Prisma.Decimal(v);
const settings = { deliveryFee: D(20), freeDeliveryMinSubtotal: D(500) };
const promo = (over: Partial<PromoInput> = {}): PromoInput => ({
  code: 'SAVE10',
  type: ShopPromoType.PERCENT,
  value: D(10),
  minSubtotal: null,
  maxDiscount: null,
  usageLimit: null,
  perStoreLimit: null,
  usedCount: 0,
  startsAt: null,
  endsAt: null,
  isActive: true,
  ...over,
});

describe('effectivePrice', () => {
  it('uses the variant price when set, else the product price', () => {
    expect(
      effectivePrice(
        { price: D(10), compareAtPrice: null },
        { price: D(12), compareAtPrice: null },
      ).price.toFixed(2),
    ).toBe('12.00');
    expect(
      effectivePrice(
        { price: D(10), compareAtPrice: null },
        { price: null, compareAtPrice: null },
      ).price.toFixed(2),
    ).toBe('10.00');
  });

  it('only shows a compare-at price that is really higher', () => {
    expect(
      effectivePrice({
        price: D(85),
        compareAtPrice: D(90),
      }).compareAtPrice?.toFixed(2),
    ).toBe('90.00');
    expect(
      effectivePrice({ price: D(85), compareAtPrice: D(85) }).compareAtPrice,
    ).toBeNull();
    expect(
      effectivePrice({ price: D(85), compareAtPrice: D(50) }).compareAtPrice,
    ).toBeNull();
  });
});

describe('priceOrder', () => {
  it('sums lines and charges delivery below the free threshold', () => {
    const r = priceOrder({
      lines: [{ unitPrice: D('12.5'), quantity: 4 }],
      settings,
    });
    expect(
      [r.subtotal, r.discount, r.deliveryFee, r.total].map((d) => d.toFixed(2)),
    ).toEqual(['50.00', '0.00', '20.00', '70.00']);
  });

  it('makes delivery free at or above the threshold', () => {
    const r = priceOrder({
      lines: [{ unitPrice: D(250), quantity: 2 }],
      settings,
    });
    expect(r.deliveryFee.toFixed(2)).toBe('0.00');
    expect(r.total.toFixed(2)).toBe('500.00');
  });

  it('charges no delivery for an empty cart', () => {
    expect(priceOrder({ lines: [], settings }).total.toFixed(2)).toBe('0.00');
  });

  it('applies a percentage promo to the subtotal only, capped by maxDiscount', () => {
    const r = priceOrder({
      lines: [{ unitPrice: D(100), quantity: 3 }],
      settings,
      promo: {
        input: promo({ value: D(20), maxDiscount: D(50) }),
        code: 'SAVE10',
        storeUses: 0,
      },
    });
    expect(r.discount.toFixed(2)).toBe('50.00');
    expect(r.total.toFixed(2)).toBe('270.00'); // 300 - 50 + 20 delivery
    expect(r.promo?.applied).toBe(true);
  });

  it('never discounts more than the subtotal for a fixed promo', () => {
    const r = priceOrder({
      lines: [{ unitPrice: D(5), quantity: 1 }],
      settings,
      promo: {
        input: promo({ type: ShopPromoType.FIXED, value: D(40) }),
        code: 'X',
        storeUses: 0,
      },
    });
    expect(r.discount.toFixed(2)).toBe('5.00');
    expect(r.total.toFixed(2)).toBe('20.00');
  });

  it('reports why a promo was not applied and charges full price', () => {
    const r = priceOrder({
      lines: [{ unitPrice: D(10), quantity: 1 }],
      settings,
      promo: {
        input: promo({ minSubtotal: D(100) }),
        code: 'SAVE10',
        storeUses: 0,
      },
    });
    expect(r.promo).toMatchObject({
      applied: false,
      rejection: 'MIN_SUBTOTAL_NOT_MET',
    });
    expect(r.discount.toFixed(2)).toBe('0.00');
  });
});

describe('checkPromo', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const ctx = { subtotal: D(100), now, storeUses: 0 };
  it.each([
    ['unknown code', null, 'NOT_FOUND'],
    ['inactive', promo({ isActive: false }), 'INACTIVE'],
    ['not started', promo({ startsAt: new Date('2026-10-01') }), 'NOT_STARTED'],
    ['expired', promo({ endsAt: new Date('2026-09-01') }), 'EXPIRED'],
    [
      'global limit',
      promo({ usageLimit: 5, usedCount: 5 }),
      'USAGE_LIMIT_REACHED',
    ],
    ['valid', promo(), null],
  ])('%s', (_label, input, expected) => {
    expect(checkPromo(input, ctx)).toBe(expected);
  });

  it('enforces the per-store limit', () => {
    expect(
      checkPromo(promo({ perStoreLimit: 1 }), { ...ctx, storeUses: 1 }),
    ).toBe('STORE_LIMIT_REACHED');
  });
});

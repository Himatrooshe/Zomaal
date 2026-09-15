import { Prisma, ShopPromoType } from '@prisma/client';

type Decimal = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface PricedLineInput {
  unitPrice: Decimal;
  quantity: number;
}

export interface PromoInput {
  code: string;
  type: ShopPromoType;
  value: Decimal;
  minSubtotal: Decimal | null;
  maxDiscount: Decimal | null;
  usageLimit: number | null;
  perStoreLimit: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export interface SettingsInput {
  deliveryFee: Decimal;
  freeDeliveryMinSubtotal: Decimal | null;
}

export type PromoRejection =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'STORE_LIMIT_REACHED'
  | 'MIN_SUBTOTAL_NOT_MET';

export interface PricingResult {
  subtotal: Decimal;
  discount: Decimal;
  deliveryFee: Decimal;
  total: Decimal;
  promo: {
    code: string;
    applied: boolean;
    rejection: PromoRejection | null;
    message: string | null;
  } | null;
}

/**
 * The price actually charged for a product/variant, and the crossed-out
 * "was" price if there is a genuine one. A variant's own price overrides the
 * product's; a compare-at price at or below the charged price is ignored so
 * the app never shows a fake discount.
 */
export function effectivePrice(
  product: { price: Decimal; compareAtPrice: Decimal | null },
  variant?: { price: Decimal | null; compareAtPrice: Decimal | null } | null,
): { price: Decimal; compareAtPrice: Decimal | null } {
  const price = variant?.price ?? product.price;
  const compareAt = variant?.compareAtPrice ?? product.compareAtPrice;
  return {
    price,
    compareAtPrice:
      compareAt && compareAt.greaterThan(price) ? compareAt : null,
  };
}

export function promoRejectionMessage(
  reason: PromoRejection,
  promo?: PromoInput | null,
): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'This promo code does not exist.';
    case 'INACTIVE':
      return 'This promo code is no longer active.';
    case 'NOT_STARTED':
      return 'This promo code is not active yet.';
    case 'EXPIRED':
      return 'This promo code has expired.';
    case 'USAGE_LIMIT_REACHED':
      return 'This promo code has reached its usage limit.';
    case 'STORE_LIMIT_REACHED':
      return 'You have already used this promo code the maximum number of times.';
    case 'MIN_SUBTOTAL_NOT_MET':
      return `This promo code needs a subtotal of at least ${promo?.minSubtotal?.toFixed(2) ?? '0.00'}.`;
  }
}

/** Why a promo can't be used right now, or null if it can. */
export function checkPromo(
  promo: PromoInput | null,
  ctx: { subtotal: Decimal; now: Date; storeUses: number },
): PromoRejection | null {
  if (!promo) return 'NOT_FOUND';
  if (!promo.isActive) return 'INACTIVE';
  if (promo.startsAt && ctx.now < promo.startsAt) return 'NOT_STARTED';
  if (promo.endsAt && ctx.now > promo.endsAt) return 'EXPIRED';
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit)
    return 'USAGE_LIMIT_REACHED';
  if (promo.perStoreLimit !== null && ctx.storeUses >= promo.perStoreLimit)
    return 'STORE_LIMIT_REACHED';
  if (promo.minSubtotal && ctx.subtotal.lessThan(promo.minSubtotal))
    return 'MIN_SUBTOTAL_NOT_MET';
  return null;
}

/**
 * Order totals. The discount applies to the product subtotal only (never the
 * delivery fee), is capped for percentage codes by maxDiscount, and can never
 * exceed the subtotal. Delivery is free once the subtotal reaches the
 * free-delivery threshold. All money is rounded to 2 decimals.
 */
export function priceOrder(input: {
  lines: PricedLineInput[];
  settings: SettingsInput;
  promo?: { input: PromoInput | null; code: string; storeUses: number } | null;
  now?: Date;
}): PricingResult {
  const now = input.now ?? new Date();
  const subtotal = input.lines
    .reduce((sum, l) => sum.plus(l.unitPrice.times(l.quantity)), ZERO)
    .toDecimalPlaces(2);

  const freeDelivery =
    input.settings.freeDeliveryMinSubtotal !== null &&
    subtotal.greaterThanOrEqualTo(input.settings.freeDeliveryMinSubtotal);
  const deliveryFee =
    input.lines.length === 0 || freeDelivery
      ? ZERO
      : input.settings.deliveryFee.toDecimalPlaces(2);

  let discount = ZERO;
  let promo: PricingResult['promo'] = null;
  if (input.promo) {
    const rejection = checkPromo(input.promo.input, {
      subtotal,
      now,
      storeUses: input.promo.storeUses,
    });
    if (rejection) {
      promo = {
        code: input.promo.code,
        applied: false,
        rejection,
        message: promoRejectionMessage(rejection, input.promo.input),
      };
    } else {
      const p = input.promo.input!;
      let raw =
        p.type === ShopPromoType.PERCENT
          ? subtotal.times(p.value).dividedBy(100)
          : p.value;
      if (p.type === ShopPromoType.PERCENT && p.maxDiscount) {
        raw = Prisma.Decimal.min(raw, p.maxDiscount);
      }
      discount = Prisma.Decimal.min(raw, subtotal).toDecimalPlaces(2);
      promo = { code: p.code, applied: true, rejection: null, message: null };
    }
  }

  const total = subtotal.minus(discount).plus(deliveryFee).toDecimalPlaces(2);
  return { subtotal, discount, deliveryFee, total, promo };
}

export function money(value: Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

export function orderNumberLabel(number: number): string {
  return `ZS-${number}`;
}

export function variantLabel(
  variant: { size: string | null; color: string | null } | null | undefined,
): string | null {
  if (!variant) return null;
  const parts = [variant.size, variant.color].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

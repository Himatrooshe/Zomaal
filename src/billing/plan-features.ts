/**
 * Entitlement keys stored on Plan.features. Only features that are gated by
 * plan live here; everything else is available on every plan. Multi-store is
 * expressed through Plan.maxStores rather than a key.
 */
export const PLAN_FEATURES = {
  ADS: 'ads',
  SHOP: 'shop',
  WHATSAPP: 'whatsapp',
} as const;

export type PlanFeature = (typeof PLAN_FEATURES)[keyof typeof PLAN_FEATURES];

export const ALL_PLAN_FEATURES: PlanFeature[] = Object.values(PLAN_FEATURES);

export function isPlanFeature(value: string): value is PlanFeature {
  return (ALL_PLAN_FEATURES as string[]).includes(value);
}

export const TRIAL_DAYS = 7;
/** Days before access ends that the "ending soon" notification fires. */
export const ENDING_SOON_DAYS = 3;
/** Delete Account grace period (Q17.7). */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/** The free trial lets merchants try everything, including multiple stores. */
export const TRIAL_ENTITLEMENTS = {
  maxStores: null as number | null,
  features: ALL_PLAN_FEATURES,
};

import type { Prisma } from '@prisma/client';

export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'TRIAL_ENDED',
  'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Status is derived from dates at read time (same approach as salary
 * OVERDUE), so accounts lock exactly when access ends without a job.
 */
export function deriveSubscriptionStatus(
  sub: { planId: string | null; accessEndsAt: Date },
  now: Date = new Date(),
): SubscriptionStatus {
  const live = sub.accessEndsAt.getTime() > now.getTime();
  if (sub.planId === null) return live ? 'TRIALING' : 'TRIAL_ENDED';
  return live ? 'ACTIVE' : 'EXPIRED';
}

export function isReadOnlyStatus(status: SubscriptionStatus): boolean {
  return status === 'TRIAL_ENDED' || status === 'EXPIRED';
}

/**
 * Prisma filter for "this owner account currently has access". Used by the
 * scheduled syncs (Q17.4: syncing stops when locked) without those modules
 * depending on BillingModule.
 */
export function activeAccountWhere(
  now: Date = new Date(),
): Prisma.UserWhereInput {
  return { subscription: { accessEndsAt: { gt: now } } };
}

/** Owner with access, or staff whose store's owner has access. */
export function userWithActiveAccountWhere(
  now: Date = new Date(),
): Prisma.UserWhereInput {
  return {
    OR: [
      activeAccountWhere(now),
      { staffMembership: { store: { user: activeAccountWhere(now) } } },
    ],
  };
}

export function addInterval(
  from: Date,
  interval: 'MONTHLY' | 'YEARLY',
  count = 1,
): Date {
  const months = interval === 'MONTHLY' ? count : count * 12;
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Jan 31 + 1 month = Feb 28/29, not Mar 3.
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function daysLeft(until: Date, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.ceil((until.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

import { SetMetadata } from '@nestjs/common';
import type { PlanFeature } from './plan-features';

export const ALLOW_WHEN_LOCKED = 'billing:allowWhenLocked';
export const REQUIRED_PLAN_FEATURE = 'billing:requiredFeature';

/**
 * Writes on this route keep working after the trial/subscription ends —
 * login, profile, billing, delete account, marking notifications read.
 */
export const AllowWhenLocked = () => SetMetadata(ALLOW_WHEN_LOCKED, true);

/** Route belongs to a feature only some plans include (e.g. Pro-only). */
export const RequirePlanFeature = (feature: PlanFeature) =>
  SetMetadata(REQUIRED_PLAN_FEATURE, feature);

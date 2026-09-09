export type RiskCategoryLabel =
  | 'returns'
  | 'cancellations'
  | 'refusals'
  | 'noAnswer'
  | 'combined';

export interface RiskCounters {
  returnsCount: number;
  cancellationsCount: number;
  refusalsCount: number;
  noAnswerCount: number;
}

export interface RiskLimits {
  useCombinedLimit: boolean;
  combinedLimit: number;
  returnsLimit: number;
  cancellationsLimit: number;
  refusalsLimit: number;
  noAnswerLimit: number;
}

export interface RiskDistance {
  category: RiskCategoryLabel;
  current: number;
  limit: number;
  /** limit - current. Zero or negative means the limit is already crossed. */
  remaining: number;
}

/**
 * The single source of truth for "how close is this customer to each
 * enabled limit". A limit of 0 means that category never contributes
 * (auto-blacklist is opt-in per category, per the Blacklist Settings
 * screen). Combined mode replaces all four category limits with one check
 * against their sum — never both at once.
 */
export function computeRiskDistances(
  counters: RiskCounters,
  settings: RiskLimits,
): RiskDistance[] {
  if (settings.useCombinedLimit) {
    if (settings.combinedLimit <= 0) return [];
    const current =
      counters.returnsCount +
      counters.cancellationsCount +
      counters.refusalsCount +
      counters.noAnswerCount;
    return [
      {
        category: 'combined',
        current,
        limit: settings.combinedLimit,
        remaining: settings.combinedLimit - current,
      },
    ];
  }

  const distances: RiskDistance[] = [];
  if (settings.returnsLimit > 0) {
    distances.push({
      category: 'returns',
      current: counters.returnsCount,
      limit: settings.returnsLimit,
      remaining: settings.returnsLimit - counters.returnsCount,
    });
  }
  if (settings.cancellationsLimit > 0) {
    distances.push({
      category: 'cancellations',
      current: counters.cancellationsCount,
      limit: settings.cancellationsLimit,
      remaining: settings.cancellationsLimit - counters.cancellationsCount,
    });
  }
  if (settings.refusalsLimit > 0) {
    distances.push({
      category: 'refusals',
      current: counters.refusalsCount,
      limit: settings.refusalsLimit,
      remaining: settings.refusalsLimit - counters.refusalsCount,
    });
  }
  if (settings.noAnswerLimit > 0) {
    distances.push({
      category: 'noAnswer',
      current: counters.noAnswerCount,
      limit: settings.noAnswerLimit,
      remaining: settings.noAnswerLimit - counters.noAnswerCount,
    });
  }
  return distances;
}

/** True if any enabled limit has been reached or exceeded. */
export function hasCrossedRiskLimit(distances: RiskDistance[]): boolean {
  return distances.some((d) => d.remaining <= 0);
}

/**
 * The single limit closest to being crossed, only when it's 0 or 1 action
 * away — the "2/3 returns, 1 more = blacklist" proximity shown on the
 * Customers/Blacklist screens. Null when nothing is that close (including
 * when every limit is disabled).
 */
export function closestRiskProximity(
  distances: RiskDistance[],
): RiskDistance | null {
  const near = distances.filter((d) => d.remaining >= 0 && d.remaining <= 1);
  if (near.length === 0) return null;
  return near.reduce((closest, d) =>
    d.remaining < closest.remaining ? d : closest,
  );
}

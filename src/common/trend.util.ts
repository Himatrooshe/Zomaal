/**
 * Reusable period-over-period comparison. Nothing like this existed anywhere
 * in the codebase before — every "trend" screen needed it independently.
 *
 * changePercent is null when previous is 0 and current is not: percentage
 * growth from a zero baseline is mathematically undefined (not "very large"),
 * so the client should render that as "new" rather than a fabricated number.
 */
export interface Trend {
  changePercent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function calculateTrend(current: number, previous: number): Trend {
  if (previous === 0) {
    return current === 0
      ? { changePercent: 0, direction: 'flat' }
      : { changePercent: null, direction: 'up' };
  }

  const raw = ((current - previous) / previous) * 100;
  const changePercent = Math.round(raw * 100) / 100;
  const direction = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';
  return { changePercent, direction };
}

/** "2026-09" for a given Date, in UTC — the bucket key for monthly grouping. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The `count` most recent month keys ending at the current UTC month,
 * oldest first — the fixed x-axis a monthly chart plots against, so a month
 * with zero activity still appears as a zero point instead of a gap.
 */
export function lastNMonthKeys(count: number, from: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1));
    keys.push(monthKey(d));
  }
  return keys;
}

/** UTC start-of-month for the first key `lastNMonthKeys` would produce. */
export function monthsAgoStart(count: number, from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - (count - 1), 1));
}

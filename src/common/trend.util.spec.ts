import { calculateTrend, lastNMonthKeys, monthKey, monthsAgoStart } from './trend.util';

describe('calculateTrend', () => {
  it('computes a positive percent change', () => {
    expect(calculateTrend(150, 100)).toEqual({ changePercent: 50, direction: 'up' });
  });

  it('computes a negative percent change', () => {
    expect(calculateTrend(50, 100)).toEqual({ changePercent: -50, direction: 'down' });
  });

  it('is flat when current equals previous', () => {
    expect(calculateTrend(100, 100)).toEqual({ changePercent: 0, direction: 'flat' });
  });

  it('is flat with a null-free 0% when both are zero', () => {
    expect(calculateTrend(0, 0)).toEqual({ changePercent: 0, direction: 'flat' });
  });

  it('returns null (not Infinity) for growth from a zero baseline', () => {
    expect(calculateTrend(500, 0)).toEqual({ changePercent: null, direction: 'up' });
  });

  it('rounds to 2 decimal places', () => {
    const result = calculateTrend(1, 3);
    expect(result.changePercent).toBeCloseTo(-66.67, 2);
  });
});

describe('monthKey', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(monthKey(new Date('2026-09-15T23:00:00.000Z'))).toBe('2026-09');
  });

  it('pads single-digit months', () => {
    expect(monthKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
  });
});

describe('lastNMonthKeys', () => {
  it('returns N keys ending at the reference month, oldest first', () => {
    const keys = lastNMonthKeys(3, new Date('2026-09-15T00:00:00.000Z'));
    expect(keys).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('crosses a year boundary correctly', () => {
    const keys = lastNMonthKeys(3, new Date('2026-01-15T00:00:00.000Z'));
    expect(keys).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('a single month returns just the current one', () => {
    expect(lastNMonthKeys(1, new Date('2026-09-15T00:00:00.000Z'))).toEqual(['2026-09']);
  });
});

describe('monthsAgoStart', () => {
  it('is the 1st of the month N-1 months back, matching lastNMonthKeys\' first key', () => {
    const from = new Date('2026-09-15T12:00:00.000Z');
    const start = monthsAgoStart(3, from);
    expect(monthKey(start)).toBe(lastNMonthKeys(3, from)[0]);
    expect(start.getUTCDate()).toBe(1);
  });
});

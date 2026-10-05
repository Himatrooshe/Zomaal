import {
  addInterval,
  daysLeft,
  deriveSubscriptionStatus,
  isReadOnlyStatus,
} from './subscription-status.util';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const LATER = new Date('2026-10-08T12:00:00.000Z');
const EARLIER = new Date('2026-10-01T12:00:00.000Z');

describe('subscription-status util', () => {
  it.each([
    [null, LATER, 'TRIALING'],
    [null, EARLIER, 'TRIAL_ENDED'],
    ['plan-1', LATER, 'ACTIVE'],
    ['plan-1', EARLIER, 'EXPIRED'],
    ['plan-1', NOW, 'EXPIRED'],
  ])('planId=%s accessEndsAt=%s → %s', (planId, accessEndsAt, expected) => {
    expect(deriveSubscriptionStatus({ planId, accessEndsAt }, NOW)).toBe(
      expected,
    );
  });

  it('only ended states are read-only', () => {
    expect(isReadOnlyStatus('TRIALING')).toBe(false);
    expect(isReadOnlyStatus('ACTIVE')).toBe(false);
    expect(isReadOnlyStatus('TRIAL_ENDED')).toBe(true);
    expect(isReadOnlyStatus('EXPIRED')).toBe(true);
  });

  it('adds calendar months and years in UTC', () => {
    expect(
      addInterval(
        new Date('2026-01-15T00:00:00.000Z'),
        'MONTHLY',
      ).toISOString(),
    ).toBe('2026-02-15T00:00:00.000Z');
    expect(
      addInterval(
        new Date('2026-01-15T00:00:00.000Z'),
        'MONTHLY',
        3,
      ).toISOString(),
    ).toBe('2026-04-15T00:00:00.000Z');
    expect(
      addInterval(new Date('2026-03-01T00:00:00.000Z'), 'YEARLY').toISOString(),
    ).toBe('2027-03-01T00:00:00.000Z');
  });

  it('clamps to the last day of shorter months', () => {
    expect(
      addInterval(
        new Date('2026-01-31T09:00:00.000Z'),
        'MONTHLY',
      ).toISOString(),
    ).toBe('2026-02-28T09:00:00.000Z');
    expect(
      addInterval(new Date('2028-02-29T00:00:00.000Z'), 'YEARLY').toISOString(),
    ).toBe('2029-02-28T00:00:00.000Z');
  });

  it('counts partial days up and never goes negative', () => {
    expect(daysLeft(LATER, NOW)).toBe(3);
    expect(daysLeft(new Date(NOW.getTime() + 60_000), NOW)).toBe(1);
    expect(daysLeft(EARLIER, NOW)).toBe(0);
  });
});

import {
  closestRiskProximity,
  computeRiskDistances,
  hasCrossedRiskLimit,
} from './customer-risk.util';

const ZERO_LIMITS = {
  useCombinedLimit: false,
  combinedLimit: 0,
  returnsLimit: 0,
  cancellationsLimit: 0,
  refusalsLimit: 0,
  noAnswerLimit: 0,
};

const ZERO_COUNTERS = {
  returnsCount: 0,
  cancellationsCount: 0,
  refusalsCount: 0,
  noAnswerCount: 0,
};

describe('computeRiskDistances', () => {
  it('returns nothing when every limit is 0 (auto-blacklist disabled)', () => {
    expect(
      computeRiskDistances({ ...ZERO_COUNTERS, returnsCount: 5 }, ZERO_LIMITS),
    ).toEqual([]);
  });

  it('only includes categories with a limit greater than 0', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 2, cancellationsCount: 1 },
      { ...ZERO_LIMITS, returnsLimit: 3 },
    );
    expect(distances).toEqual([
      { category: 'returns', current: 2, limit: 3, remaining: 1 },
    ]);
  });

  it('reports every enabled category, not just one', () => {
    const distances = computeRiskDistances(
      {
        returnsCount: 1,
        cancellationsCount: 2,
        refusalsCount: 0,
        noAnswerCount: 4,
      },
      {
        useCombinedLimit: false,
        combinedLimit: 0,
        returnsLimit: 3,
        cancellationsLimit: 2,
        refusalsLimit: 1,
        noAnswerLimit: 4,
      },
    );
    expect(distances).toEqual([
      { category: 'returns', current: 1, limit: 3, remaining: 2 },
      { category: 'cancellations', current: 2, limit: 2, remaining: 0 },
      { category: 'refusals', current: 0, limit: 1, remaining: 1 },
      { category: 'noAnswer', current: 4, limit: 4, remaining: 0 },
    ]);
  });

  it('collapses to a single combined distance when useCombinedLimit is on', () => {
    const distances = computeRiskDistances(
      {
        returnsCount: 1,
        cancellationsCount: 1,
        refusalsCount: 1,
        noAnswerCount: 0,
      },
      { ...ZERO_LIMITS, useCombinedLimit: true, combinedLimit: 4 },
    );
    expect(distances).toEqual([
      { category: 'combined', current: 3, limit: 4, remaining: 1 },
    ]);
  });

  it('ignores the four category limits entirely when combined mode is on, even if set', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 10 },
      {
        useCombinedLimit: true,
        combinedLimit: 0, // disabled
        returnsLimit: 1, // would have fired in per-category mode
        cancellationsLimit: 0,
        refusalsLimit: 0,
        noAnswerLimit: 0,
      },
    );
    expect(distances).toEqual([]);
  });
});

describe('hasCrossedRiskLimit', () => {
  it('is false when nothing is enabled', () => {
    expect(
      hasCrossedRiskLimit(computeRiskDistances(ZERO_COUNTERS, ZERO_LIMITS)),
    ).toBe(false);
  });

  it('is true once an enabled category reaches its limit', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 3 },
      { ...ZERO_LIMITS, returnsLimit: 3 },
    );
    expect(hasCrossedRiskLimit(distances)).toBe(true);
  });

  it('is false while still under every enabled limit', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 2 },
      { ...ZERO_LIMITS, returnsLimit: 3 },
    );
    expect(hasCrossedRiskLimit(distances)).toBe(false);
  });

  it('is true in combined mode once the sum reaches the combined limit', () => {
    const distances = computeRiskDistances(
      {
        returnsCount: 2,
        cancellationsCount: 2,
        refusalsCount: 0,
        noAnswerCount: 0,
      },
      { ...ZERO_LIMITS, useCombinedLimit: true, combinedLimit: 4 },
    );
    expect(hasCrossedRiskLimit(distances)).toBe(true);
  });
});

describe('closestRiskProximity', () => {
  it('is null when nothing is within 1 action of a limit', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 1 },
      { ...ZERO_LIMITS, returnsLimit: 5 },
    );
    expect(closestRiskProximity(distances)).toBeNull();
  });

  it('returns the category exactly 1 action away', () => {
    const distances = computeRiskDistances(
      { ...ZERO_COUNTERS, returnsCount: 2 },
      { ...ZERO_LIMITS, returnsLimit: 3 },
    );
    expect(closestRiskProximity(distances)).toEqual({
      category: 'returns',
      current: 2,
      limit: 3,
      remaining: 1,
    });
  });

  it('picks the single closest category when several are near their limit', () => {
    const distances = computeRiskDistances(
      {
        returnsCount: 2,
        cancellationsCount: 3,
        refusalsCount: 0,
        noAnswerCount: 0,
      },
      {
        useCombinedLimit: false,
        combinedLimit: 0,
        returnsLimit: 3, // remaining 1
        cancellationsLimit: 3, // remaining 0 — already crossed, still "closest"
        refusalsLimit: 0,
        noAnswerLimit: 0,
      },
    );
    expect(closestRiskProximity(distances)).toEqual({
      category: 'cancellations',
      current: 3,
      limit: 3,
      remaining: 0,
    });
  });

  it('works in combined mode too', () => {
    const distances = computeRiskDistances(
      {
        returnsCount: 1,
        cancellationsCount: 1,
        refusalsCount: 1,
        noAnswerCount: 0,
      },
      { ...ZERO_LIMITS, useCombinedLimit: true, combinedLimit: 4 },
    );
    expect(closestRiskProximity(distances)).toEqual({
      category: 'combined',
      current: 3,
      limit: 4,
      remaining: 1,
    });
  });
});

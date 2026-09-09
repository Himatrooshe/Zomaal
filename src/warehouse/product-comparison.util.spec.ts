import {
  ComparisonInsightMetrics,
  computeComparisonInsight,
} from './product-comparison.util';

const ZERO: ComparisonInsightMetrics = {
  deliveryRate: 0,
  returnRate: 0,
  cancellationRate: 0,
  revenue: 0,
  profit: 0,
  avgOrderValue: 0,
  cpo: 0,
};

describe('computeComparisonInsight', () => {
  it('returns null when both products are identical', () => {
    expect(computeComparisonInsight(ZERO, ZERO, 'A', 'B')).toBeNull();
  });

  it('returns null when both products have zero orders (every lower value is 0)', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, deliveryRate: 0, revenue: 0 };
    const b: ComparisonInsightMetrics = { ...ZERO, deliveryRate: 50, revenue: 100 };
    // lower side is 0 for both differing metrics -> both skipped -> null
    expect(computeComparisonInsight(a, b, 'A', 'B')).toBeNull();
  });

  it('picks the metric with the single largest relative gap', () => {
    const a: ComparisonInsightMetrics = {
      ...ZERO,
      revenue: 100, // +100% vs b (lower=50)
      deliveryRate: 60, // +20% vs b (lower=50) -> 20% relative
    };
    const b: ComparisonInsightMetrics = {
      ...ZERO,
      revenue: 50,
      deliveryRate: 50,
    };
    const insight = computeComparisonInsight(a, b, 'Product A', 'Product B');
    expect(insight).not.toBeNull();
    expect(insight!.metric).toBe('revenue');
    expect(insight!.winner).toBe('A');
    expect(insight!.message).toBe(
      'Product A has 100% better revenue than Product B',
    );
  });

  it('treats a lower-is-better metric correctly — the side with the lower value wins', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, returnRate: 10 };
    const b: ComparisonInsightMetrics = { ...ZERO, returnRate: 40 };
    const insight = computeComparisonInsight(a, b, 'A', 'B');
    expect(insight).not.toBeNull();
    expect(insight!.metric).toBe('returnRate');
    // b's value (40) is higher, but lower-is-better means A (10) wins
    expect(insight!.winner).toBe('A');
    expect(insight!.message).toContain('A has');
  });

  it('treats cost-per-order as lower-is-better', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, cpo: 20 };
    const b: ComparisonInsightMetrics = { ...ZERO, cpo: 10 };
    const insight = computeComparisonInsight(a, b, 'A', 'B');
    expect(insight).not.toBeNull();
    expect(insight!.metric).toBe('cpo');
    expect(insight!.winner).toBe('B');
  });

  it('skips a metric when the lower side is zero or negative, even if it would otherwise be the biggest gap', () => {
    const a: ComparisonInsightMetrics = {
      ...ZERO,
      profit: 1000, // b's profit is 0 -> divide-by-zero risk, must be skipped
      deliveryRate: 55, // lower=50 -> 10% relative, the only comparable metric
    };
    const b: ComparisonInsightMetrics = {
      ...ZERO,
      profit: 0,
      deliveryRate: 50,
    };
    const insight = computeComparisonInsight(a, b, 'A', 'B');
    expect(insight).not.toBeNull();
    expect(insight!.metric).toBe('deliveryRate');
  });

  it('skips a metric when the lower side is negative', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, profit: 100 };
    const b: ComparisonInsightMetrics = { ...ZERO, profit: -50 };
    // profit skipped (lower <= 0); nothing else differs -> null
    expect(computeComparisonInsight(a, b, 'A', 'B')).toBeNull();
  });

  it('rounds the relative difference to the nearest whole percent', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, avgOrderValue: 133 };
    const b: ComparisonInsightMetrics = { ...ZERO, avgOrderValue: 100 };
    const insight = computeComparisonInsight(a, b, 'A', 'B');
    expect(insight!.message).toBe(
      'A has 33% better average order value than B',
    );
  });

  it('picks product B as winner when B has the larger value on a higher-is-better metric', () => {
    const a: ComparisonInsightMetrics = { ...ZERO, revenue: 50 };
    const b: ComparisonInsightMetrics = { ...ZERO, revenue: 150 };
    const insight = computeComparisonInsight(a, b, 'A', 'B');
    expect(insight!.winner).toBe('B');
    expect(insight!.message).toBe('B has 200% better revenue than A');
  });
});

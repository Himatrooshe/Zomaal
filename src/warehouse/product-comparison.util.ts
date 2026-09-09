export type ComparisonInsightMetric =
  | 'deliveryRate'
  | 'returnRate'
  | 'cancellationRate'
  | 'revenue'
  | 'profit'
  | 'avgOrderValue'
  | 'cpo';

export interface ComparisonInsightMetrics {
  deliveryRate: number;
  returnRate: number;
  cancellationRate: number;
  revenue: number;
  profit: number;
  avgOrderValue: number;
  cpo: number;
}

export interface ComparisonInsight {
  metric: ComparisonInsightMetric;
  winner: 'A' | 'B';
  message: string;
}

// true = higher is better for this metric (revenue, profit, AOV, delivery
// rate); false = lower is better (return/cancellation rate, cost per order).
const HIGHER_IS_BETTER: Record<ComparisonInsightMetric, boolean> = {
  deliveryRate: true,
  returnRate: false,
  cancellationRate: false,
  revenue: true,
  profit: true,
  avgOrderValue: true,
  cpo: false,
};

const METRIC_LABEL: Record<ComparisonInsightMetric, string> = {
  deliveryRate: 'delivery rate',
  returnRate: 'return rate',
  cancellationRate: 'cancellation rate',
  revenue: 'revenue',
  profit: 'profit',
  avgOrderValue: 'average order value',
  cpo: 'cost per order',
};

const INSIGHT_METRICS = Object.keys(
  HIGHER_IS_BETTER,
) as ComparisonInsightMetric[];

/**
 * Picks the single metric with the largest relative gap between the two
 * products and phrases one sentence from it — the Compare Products screen's
 * blue "Insight" banner. Relative gap = (higher - lower) / lower, the same
 * "N% better" framing the mockup itself uses for a rate metric, applied
 * uniformly to every metric here rather than switching formulas per type.
 *
 * A metric is skipped (not just scored 0) when the two products tie on it,
 * or when the lower of the two values is <= 0 — dividing by zero, or by a
 * product with literally no orders in the period, can't produce a clean
 * percentage. Returns null when every metric was skipped (nothing
 * meaningful to call out, including both products having zero orders).
 */
export function computeComparisonInsight(
  a: ComparisonInsightMetrics,
  b: ComparisonInsightMetrics,
  nameA: string,
  nameB: string,
): ComparisonInsight | null {
  let best: {
    metric: ComparisonInsightMetric;
    winner: 'A' | 'B';
    relativeDiff: number;
  } | null = null;

  for (const metric of INSIGHT_METRICS) {
    const valueA = a[metric];
    const valueB = b[metric];
    if (valueA === valueB) continue;

    const aIsHigher = valueA > valueB;
    const lowerValue = aIsHigher ? valueB : valueA;
    if (lowerValue <= 0) continue;

    const higherValue = aIsHigher ? valueA : valueB;
    const relativeDiff = ((higherValue - lowerValue) / lowerValue) * 100;
    const winnerIsA = HIGHER_IS_BETTER[metric] ? aIsHigher : !aIsHigher;

    if (!best || relativeDiff > best.relativeDiff) {
      best = { metric, winner: winnerIsA ? 'A' : 'B', relativeDiff };
    }
  }

  if (!best) return null;

  const winnerName = best.winner === 'A' ? nameA : nameB;
  const loserName = best.winner === 'A' ? nameB : nameA;
  const roundedDiff = Math.round(best.relativeDiff);

  return {
    metric: best.metric,
    winner: best.winner,
    message: `${winnerName} has ${roundedDiff}% better ${METRIC_LABEL[best.metric]} than ${loserName}`,
  };
}

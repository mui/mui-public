import type { Interval, MetricComparison } from './analyzeRun';
import type { RunMetricDefinition } from './schema';

/**
 * How a run report's numbers read, for every renderer of one: the terminal table, the pull request
 * comment and the dashboard show the same run, so they format it the same way.
 */

const DEFAULT_SCALAR_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };
const DEFAULT_DISCRETE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

/** A value in its metric's own format — `12.3 ms`, `4`. */
export function formatValue(value: number, definition: RunMetricDefinition): string {
  const options =
    definition.format ??
    (definition.kind === 'discrete' ? DEFAULT_DISCRETE_FORMAT : DEFAULT_SCALAR_FORMAT);
  return new Intl.NumberFormat('en-US', options).format(value);
}

/** Both bounds signed, so the direction of a difference reads without the verdict beside it. */
export function formatPercent(interval: Interval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** A comparison as one phrase: `worse +2.7% – +6.8%`, `unsure -1.2% – +0.9%`. */
export function formatComparison(comparison: MetricComparison): string {
  return `${comparison.change} ${formatPercent(comparison.relative)}`;
}

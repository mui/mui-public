import { CONFIDENCE } from './analyzeRun';
import type {
  BenchmarkAnalysis,
  Change,
  Interval,
  MetricComparison,
  Regression,
} from './analyzeRun';
import type { RunBenchmark, RunMetricDefinition } from './schema';

/**
 * How a run report's numbers read, for every renderer of one: the terminal table, the pull request
 * comment and the dashboard show the same run, so they format it the same way.
 */

const DEFAULT_SCALAR_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };
const DEFAULT_DISCRETE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

// Constructing a formatter is the expensive part, and a table formats every cell.
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', options);
    formatters.set(key, formatter);
  }
  return formatter;
}

/** A value in its metric's own format — `12.3 ms`, `4`. */
export function formatValue(value: number, definition: RunMetricDefinition): string {
  const options =
    definition.format ??
    (definition.kind === 'discrete' ? DEFAULT_DISCRETE_FORMAT : DEFAULT_SCALAR_FORMAT);
  return formatterFor(options).format(value);
}

/** Both bounds signed, so the direction of a difference reads without the verdict beside it. */
export function formatPercent(interval: Interval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/**
 * The colour a comparison draws the eye with: `error` for a regression that fails the check,
 * `warning` for any other change for the worse, `success` for one for the better, and `none` when
 * nothing moved.
 */
export type ChangeTone = 'error' | 'warning' | 'success' | 'none';

export function changeTone({ change, severity }: MetricComparison): ChangeTone {
  if (severity === 'error') {
    return 'error';
  }
  if (change === 'worse') {
    return 'warning';
  }
  return change === 'better' ? 'success' : 'none';
}

/** How a change reads: `better`, `worse`, `no change detected`, `unchanged`. */
export function formatChange(change: Change): string {
  return change === 'undetected' ? 'no change detected' : change;
}

/**
 * A comparison as one phrase: `worse +2.7% – +6.8%`, `no change detected -1.2% – +0.9%`,
 * `unchanged`.
 */
export function formatComparison(comparison: MetricComparison): string {
  const label = formatChange(comparison.change);
  return comparison.change === 'unchanged'
    ? label
    : `${label} ${formatPercent(comparison.relative)}`;
}

/** What a comparison column is headed: `Δ vs baseline` for a build, `theirs vs ours` for a variant. */
export function formatComparisonLabel(
  benchmark: RunBenchmark,
  { subject, against }: Pick<MetricComparison, 'subject' | 'against'>,
): string {
  return benchmark.kind === 'baseline' ? `Δ vs ${against}` : `${subject} vs ${against}`;
}

export interface BenchmarkTableColumn {
  header: string;
  /** `value` columns hold numbers, `comparison` columns a formatted comparison. */
  kind: 'label' | 'value' | 'comparison';
}

export interface BenchmarkTableRow {
  metric: string;
  cells: string[];
  /** The comparisons behind the row's `comparison` cells, in column order. */
  comparisons: MetricComparison[];
}

/**
 * A benchmark's results as one table, for every renderer of it: per metric, each variant's median
 * and each comparison.
 */
export function benchmarkTable({ benchmark, metrics }: BenchmarkAnalysis): {
  columns: BenchmarkTableColumn[];
  rows: BenchmarkTableRow[];
} {
  // Builds read old to new, the baseline first, like a diff; compared cases keep the reference
  // first, as the comparison columns measure against it.
  const columnOrder =
    benchmark.kind === 'baseline' ? [...benchmark.variants].reverse() : benchmark.variants;
  const columns: BenchmarkTableColumn[] = [
    { header: 'Metric', kind: 'label' },
    ...columnOrder.map((variant) => ({ header: variant, kind: 'value' as const })),
    ...(metrics[0]?.comparisons ?? []).map((comparison) => ({
      header: formatComparisonLabel(benchmark, comparison),
      kind: 'comparison' as const,
    })),
  ];
  const rows = metrics.map(({ metric, definition, variants, comparisons }) => ({
    metric,
    comparisons,
    cells: [
      metric,
      ...columnOrder.map((variant) => formatValue(variants[variant].median, definition)),
      ...comparisons.map(formatComparison),
    ],
  }));
  return { columns, rows };
}

/** A duration at a glance: `850ms`, `42s`, `3m 05s`, `1h 02m`. */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return minutes < 60
    ? `${minutes}m ${twoDigits(seconds % 60)}s`
    : `${Math.floor(minutes / 60)}h ${twoDigits(minutes % 60)}m`;
}

/**
 * How many rounds a benchmark ran, how long it took, and whether sampling resolved: `50 rounds`,
 * `50 + 23 rounds · 1m 12s` past the sample size, `50 + 312 rounds · 3m 04s · timed out`. `null`
 * for a benchmark that measured nothing.
 */
export function formatRounds(benchmark: RunBenchmark): string | null {
  const [reference] = benchmark.variants;
  const rounds = Object.values(benchmark.samples?.[reference] ?? {})[0]?.length;
  if (rounds === undefined) {
    return null;
  }
  const sampleSize = benchmark.sampling?.sampleSize ?? rounds;
  return [
    rounds > sampleSize ? `${sampleSize} + ${rounds - sampleSize} rounds` : `${rounds} rounds`,
    benchmark.durationMs === undefined ? null : formatDuration(benchmark.durationMs),
    benchmark.sampling?.timedOut ? 'timed out' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The line a run is summed up in: how many benchmarks measured, regressed, timed out and failed, and
 * how long the run took when the report says.
 */
export function formatRunSummary(
  analyses: BenchmarkAnalysis[],
  regressions: Regression[],
  durationMs?: number,
): string {
  const measured = analyses.filter((analysis) => !analysis.benchmark.error).length;
  const failed = analyses.length - measured;
  const regressed = new Set(regressions.map((regression) => regression.benchmark)).size;
  const timedOut = analyses.filter((analysis) => analysis.benchmark.sampling?.timedOut).length;
  return [
    `${measured} benchmark${measured === 1 ? '' : 's'} measured`,
    regressed > 0 ? `${regressed} with regressions` : 'no regressions',
    timedOut > 0 ? `${timedOut} timed out` : null,
    failed > 0 ? `${failed} failed` : null,
    durationMs === undefined ? null : `ran ${formatDuration(durationMs)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** How to read a run's numbers, under every rendering of it. */
export function runReportFootnote(analyses: BenchmarkAnalysis[]): string {
  const alarmed = Math.max(
    CONFIDENCE,
    ...analyses.flatMap(({ metrics }) =>
      metrics.flatMap(({ comparisons }) => comparisons.map((comparison) => comparison.confidence)),
    ),
  );
  const levels =
    alarmed > CONFIDENCE
      ? `${formatConfidence(alarmed)} for alarmed metrics, ${formatConfidence(CONFIDENCE)} otherwise`
      : formatConfidence(CONFIDENCE);
  return `Medians; Δ is the confidence interval of the paired per-round difference (${levels}).`;
}

function formatConfidence(fraction: number): string {
  return `${formatterFor(DEFAULT_SCALAR_FORMAT).format(fraction * 100)}%`;
}

import { ALARMED_CONFIDENCE, CONFIDENCE, tCritical } from './analyzeRun';
import type {
  BenchmarkAnalysis,
  Change,
  Interval,
  AlarmedChange,
  MetricComparison,
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

/** The colour a renderer draws the eye with; a `Severity` is one too. */
export type Tone = 'error' | 'warning' | 'success' | 'none';

/**
 * The colour a comparison draws the eye with: `error` for a regression that fails the check,
 * `warning` for any other change for the worse, `success` for one for the better, and `none` when
 * nothing moved.
 */
export function changeTone({ change, severity }: MetricComparison): Tone {
  if (severity === 'error') {
    return 'error';
  }
  if (change === 'worse') {
    return 'warning';
  }
  return change === 'better' ? 'success' : 'none';
}

// Rounds past which the t-distribution is the normal one, for estimating how many a run needs.
const MANY_ROUNDS = 1000;

/**
 * The colour a comparison's precision draws the eye with: `error` when a regression the alarm would
 * raise — one past its `error` band — could hide in the interval, `none` otherwise.
 */
export function precisionTone({ alarm, precision }: MetricComparison): Tone {
  return alarm?.error !== undefined && precision >= alarm.error ? 'error' : 'none';
}

/** A comparison's precision as it reads: `±1.4%`, or `±0.5` for a discrete metric. */
export function formatPrecision(comparison: MetricComparison, definition: RunMetricDefinition) {
  return definition.kind === 'discrete'
    ? `±${comparison.precision.toFixed(1)}`
    : `±${(comparison.precision * 100).toFixed(1)}%`;
}

/**
 * What lies behind a precision: the per-round noise, and how many rounds would resolve the alarm's
 * `error` band — `±2.0% per round · about 2 rounds resolve ±5%`.
 */
export function formatPrecisionDetail(
  comparison: MetricComparison,
  definition: RunMetricDefinition,
): string {
  const noise = `±${comparison.noise.toFixed(1)}% per round`;
  const band = comparison.alarm?.error;
  if (definition.kind === 'discrete' || !band) {
    return noise;
  }
  // Rounds for a half-width of the band: (z × noise / band)².
  const z = tCritical(MANY_ROUNDS, comparison.confidence);
  const rounds = Math.ceil(((z * comparison.noise) / (band * 100)) ** 2);
  return `${noise} · about ${rounds} rounds resolve ±${formatterFor(DEFAULT_SCALAR_FORMAT).format(band * 100)}%`;
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
  /**
   * `value` columns hold numbers, `comparison` columns a formatted comparison, `precision` columns
   * how precisely that comparison was pinned down.
   */
  kind: 'label' | 'value' | 'comparison' | 'precision';
  /** For a `comparison` or `precision` column: which of a row's `comparisons` it shows. */
  comparison?: number;
}

export interface BenchmarkTableRow {
  metric: string;
  definition: RunMetricDefinition;
  cells: string[];
  /** The comparisons behind the row's `comparison` cells, in column order. */
  comparisons: MetricComparison[];
}

/**
 * A benchmark's results as one table, for every renderer of it: per metric, each variant's median
 * and each comparison, and with `precision`, how precisely each comparison was pinned down.
 */
export function benchmarkTable(
  { benchmark, metrics }: BenchmarkAnalysis,
  { precision = false }: { precision?: boolean } = {},
): {
  columns: BenchmarkTableColumn[];
  rows: BenchmarkTableRow[];
} {
  // Builds read old to new, the baseline first, like a diff; compared cases keep the reference
  // first, as the comparison columns measure against it.
  const columnOrder =
    benchmark.kind === 'baseline' ? [...benchmark.variants].reverse() : benchmark.variants;
  const comparisonHeaders = (metrics[0]?.comparisons ?? []).map((comparison) =>
    formatComparisonLabel(benchmark, comparison),
  );
  const columns: BenchmarkTableColumn[] = [
    { header: 'Metric', kind: 'label' },
    ...columnOrder.map((variant) => ({ header: variant, kind: 'value' as const })),
    ...comparisonHeaders.map((header, comparison) => ({
      header,
      kind: 'comparison' as const,
      comparison,
    })),
    ...(precision
      ? comparisonHeaders.map((header, comparison) => ({
          header: comparisonHeaders.length === 1 ? 'Precision' : `${header} ±`,
          kind: 'precision' as const,
          comparison,
        }))
      : []),
  ];
  const rows = metrics.map(({ metric, definition, variants, comparisons }) => ({
    metric,
    definition,
    comparisons,
    cells: [
      metric,
      ...columnOrder.map((variant) => formatValue(variants[variant].median, definition)),
      ...comparisons.map(formatComparison),
      ...(precision
        ? comparisons.map((comparison) => formatPrecision(comparison, definition))
        : []),
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
  regressions: AlarmedChange[],
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
  const alarmed = analyses.some(({ metrics }) =>
    metrics.some(({ comparisons }) => comparisons.some((comparison) => comparison.alarm !== null)),
  );
  const levels = alarmed
    ? `${formatConfidence(ALARMED_CONFIDENCE)} for alarmed metrics, ${formatConfidence(CONFIDENCE)} otherwise`
    : formatConfidence(CONFIDENCE);
  return `Medians; Δ is the confidence interval of the paired per-round difference (${levels}).`;
}

function formatConfidence(fraction: number): string {
  return `${formatterFor(DEFAULT_SCALAR_FORMAT).format(fraction * 100)}%`;
}

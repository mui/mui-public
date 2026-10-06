import { CONFIDENCE } from './analyzeRun';
import type { BenchmarkAnalysis, Interval, MetricComparison, Regression } from './analyzeRun';
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

/** A comparison as one phrase: `worse +2.7% – +6.8%`, `unsure -1.2% – +0.9%`. */
export function formatComparison(comparison: MetricComparison): string {
  return `${comparison.change} ${formatPercent(comparison.relative)}`;
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
  const columns: BenchmarkTableColumn[] = [
    { header: 'Metric', kind: 'label' },
    ...benchmark.variants.map((variant) => ({ header: variant, kind: 'value' as const })),
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
      ...benchmark.variants.map((variant) => formatValue(variants[variant].median, definition)),
      ...comparisons.map(formatComparison),
    ],
  }));
  return { columns, rows };
}

/**
 * How many rounds a benchmark ran, and whether sampling resolved: `50 rounds`, `50 + 23 rounds` past
 * the sample size, `50 + 312 rounds · timed out`. `null` for a benchmark that measured nothing.
 */
export function formatRounds(benchmark: RunBenchmark): string | null {
  const [reference] = benchmark.variants;
  const rounds = Object.values(benchmark.samples?.[reference] ?? {})[0]?.length;
  if (rounds === undefined) {
    return null;
  }
  const sampleSize = benchmark.sampling?.sampleSize ?? rounds;
  const counted =
    rounds > sampleSize ? `${sampleSize} + ${rounds - sampleSize} rounds` : `${rounds} rounds`;
  return benchmark.sampling?.timedOut ? `${counted} · timed out` : counted;
}

/** The line a run is summed up in: how many benchmarks measured, regressed, timed out and failed. */
export function formatRunSummary(analyses: BenchmarkAnalysis[], regressions: Regression[]): string {
  const measured = analyses.filter((analysis) => !analysis.benchmark.error).length;
  const failed = analyses.length - measured;
  const regressed = new Set(regressions.map((regression) => regression.benchmark)).size;
  const timedOut = analyses.filter((analysis) => analysis.benchmark.sampling?.timedOut).length;
  return [
    `${measured} benchmark${measured === 1 ? '' : 's'} measured`,
    regressed > 0 ? `${regressed} with regressions` : 'no regressions',
    timedOut > 0 ? `${timedOut} timed out` : null,
    failed > 0 ? `${failed} failed` : null,
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
  const interval =
    alarmed > CONFIDENCE
      ? 'Each Δ is a confidence interval on the paired per-round difference, relative to the ' +
        `variant it is measured against: ${formatConfidence(alarmed)} where a change can raise ` +
        'an alarm, so that together they raise a false one at most 5% of the time, and ' +
        `${formatConfidence(CONFIDENCE)} for the rest`
      : `Each Δ is a ${formatConfidence(CONFIDENCE)} confidence interval on the paired per-round ` +
        'difference, relative to the variant it is measured against';
  return (
    `Each value is a median. ${interval}; "unsure" means it straddles zero — the expected ` +
    'result for two equivalent builds.'
  );
}

function formatConfidence(fraction: number): string {
  return `${formatterFor(DEFAULT_SCALAR_FORMAT).format(fraction * 100)}%`;
}

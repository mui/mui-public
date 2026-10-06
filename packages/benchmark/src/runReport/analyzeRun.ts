import { calculateMean, quantile } from '../stats';
import { baseMetricName } from '../metricCore';
import type { BenchmarkRunReport, RunBenchmark, RunMetricDefinition } from './schema';

/**
 * The one analysis of a run report, shared by the runner's table, the pull request comment and the
 * dashboard, so they cannot disagree about what a run found.
 *
 * Variants are compared on paired differences: each round measured every variant once, so the
 * per-round difference cancels whatever the machine was doing during that round, and its
 * confidence interval is far tighter than one computed from two independent sets of samples.
 *
 * Intervals are 95%, except where a change can raise an alarm: there, every such comparison in the
 * run shares the 5% chance of a false one (Bonferroni), so a run of unchanged code raises one at
 * most 5% of the time however many it checks, rather than 5% per comparison.
 */

export interface Interval {
  low: number;
  high: number;
}

export interface SampleSummary {
  count: number;
  median: number;
}

/**
 * Which way a resolved change went, given the metric's direction; `undetected` if it did not
 * resolve — no change detected — and `unchanged` if every round measured the same on both sides,
 * a render count, say.
 */
export type Change = 'better' | 'worse' | 'undetected' | 'unchanged';

/** How much a change for the worse matters, per the metric's alarm. */
export type Severity = 'error' | 'warning' | 'none';

export interface MetricComparison {
  /** The variant the difference is about. */
  subject: string;
  /** The variant it is measured against. */
  against: string;
  /** The level of the intervals: 95%, or stricter where a change can raise an alarm. */
  confidence: number;
  /** `subject − against`, in the metric's unit: confidence interval of the mean difference. */
  absolute: Interval;
  /** The same, as a percentage of `against`'s mean. */
  relative: Interval;
  change: Change;
  severity: Severity;
}

export interface MetricAnalysis {
  metric: string;
  definition: RunMetricDefinition;
  variants: Record<string, SampleSummary>;
  comparisons: MetricComparison[];
}

export interface BenchmarkAnalysis {
  benchmark: RunBenchmark;
  /** Empty for a benchmark that failed. */
  metrics: MetricAnalysis[];
}

/** The confidence level of an interval no alarm depends on. */
export const CONFIDENCE = 0.95;

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0, by the Lanczos approximation. */
function logGamma(x: number): number {
  const shifted = x - 1;
  let sum = LANCZOS[0];
  for (let index = 1; index < LANCZOS.length; index += 1) {
    sum += LANCZOS[index] / (shifted + index);
  }
  const base = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(base) - base + Math.log(sum);
}

/** The continued fraction of the incomplete beta function, by Lentz's method. */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const guard = (value: number) => (Math.abs(value) < tiny ? tiny : value);
  let numerator = 1;
  let denominator = 1 / guard(1 - ((a + b) * x) / (a + 1));
  let result = denominator;
  for (let step = 1; step <= 300; step += 1) {
    const twice = 2 * step;
    const even = (step * (b - step) * x) / ((a + twice - 1) * (a + twice));
    const odd = (-(a + step) * (a + b + step) * x) / ((a + twice) * (a + twice + 1));
    let factor = 1;
    for (const coefficient of [even, odd]) {
      denominator = 1 / guard(1 + coefficient * denominator);
      numerator = guard(1 + coefficient / numerator);
      factor = denominator * numerator;
      result *= factor;
    }
    if (Math.abs(factor - 1) < 1e-15) {
      break;
    }
  }
  return result;
}

/** The regularized incomplete beta function Iₓ(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

const criticalValues = new Map<string, number>();

/** The two-sided critical value of Student's t at a confidence level, 95% by default. */
export function tCritical(degreesOfFreedom: number, confidence = CONFIDENCE): number {
  const key = `${degreesOfFreedom}:${confidence}`;
  const cached = criticalValues.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const df = Math.max(degreesOfFreedom, 1);
  // The chance of |t| beyond `bound`, which only falls as `bound` grows, so bisect on it.
  const tail = (bound: number) => incompleteBeta(df / (df + bound * bound), df / 2, 0.5);
  const alpha = 1 - confidence;
  let low = 0;
  let high = 1;
  while (tail(high) > alpha) {
    high *= 2;
  }
  for (let step = 0; step < 100; step += 1) {
    const middle = (low + high) / 2;
    if (tail(middle) > alpha) {
      low = middle;
    } else {
      high = middle;
    }
  }
  criticalValues.set(key, high);
  return high;
}

/** The confidence interval of the mean. A single value is its own degenerate interval. */
export function meanInterval(values: number[], confidence = CONFIDENCE): Interval {
  const mean = calculateMean(values);
  if (values.length < 2) {
    return { low: mean, high: mean };
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const halfWidth = tCritical(values.length - 1, confidence) * Math.sqrt(variance / values.length);
  return { low: mean - halfWidth, high: mean + halfWidth };
}

/**
 * The confidence level of each comparison that can raise an alarm, when `familySize` of them share
 * the run's 5% chance of a false alarm.
 */
export function alarmedConfidence(familySize: number): number {
  return 1 - (1 - CONFIDENCE) / Math.max(familySize, 1);
}

export function median(values: number[]): number {
  return quantile(
    [...values].sort((left, right) => left - right),
    0.5,
  );
}

function summarizeSamples(values: number[]): SampleSummary {
  return { count: values.length, median: median(values) };
}

const DEFAULT_DEFINITION: RunMetricDefinition = { kind: 'scalar' };

/** A metric's definition; a `name#id` sub-series is defined by its base metric. */
function definitionOf(
  metrics: Record<string, RunMetricDefinition>,
  metric: string,
): RunMetricDefinition {
  return metrics[metric] ?? metrics[baseMetricName(metric)] ?? DEFAULT_DEFINITION;
}

/**
 * How far a change went in the bad direction, at the least: the interval bound nearest zero, in
 * the unit the alarm thresholds use — a fraction for a scalar metric, a count for a discrete one.
 */
function worseningAtLeast(
  comparison: Pick<MetricComparison, 'absolute' | 'relative'>,
  definition: RunMetricDefinition,
): number {
  const lowerIsBetter = definition.alarm?.direction !== 'higherIsBetter';
  if (definition.kind === 'discrete') {
    return lowerIsBetter ? comparison.absolute.low : -comparison.absolute.high;
  }
  return (lowerIsBetter ? comparison.relative.low : -comparison.relative.high) / 100;
}

function severityOf(
  comparison: Pick<MetricComparison, 'absolute' | 'relative' | 'change'>,
  definition: RunMetricDefinition,
): Severity {
  const { alarm } = definition;
  if (comparison.change !== 'worse' || !alarm) {
    return 'none';
  }
  if (alarm.error === undefined && alarm.warn === undefined) {
    return 'error';
  }
  const worsening = worseningAtLeast(comparison, definition);
  if (alarm.error !== undefined && worsening >= alarm.error) {
    return 'error';
  }
  if (alarm.warn !== undefined && worsening >= alarm.warn) {
    return 'warning';
  }
  return 'none';
}

/** The per-round differences `subject − against`, over the rounds both have. */
function differencesOf(subject: number[], against: number[]): number[] {
  const rounds = Math.min(subject.length, against.length);
  return Array.from({ length: rounds }, (_, round) => subject[round] - against[round]);
}

export function compareSamples(
  subject: { name: string; values: number[] },
  against: { name: string; values: number[] },
  definition: RunMetricDefinition,
  confidence = CONFIDENCE,
): MetricComparison {
  const differences = differencesOf(subject.values, against.values);
  const rounds = differences.length;
  const absolute = meanInterval(differences, confidence);
  const reference = calculateMean(against.values.slice(0, rounds));
  const relative = {
    low: (absolute.low / reference) * 100,
    high: (absolute.high / reference) * 100,
  };

  let change: Change = 'undetected';
  if (rounds > 0 && differences.every((difference) => difference === 0)) {
    change = 'unchanged';
  } else if (absolute.low > 0 || absolute.high < 0) {
    const increased = absolute.low > 0;
    const lowerIsBetter = definition.alarm?.direction !== 'higherIsBetter';
    change = increased === lowerIsBetter ? 'worse' : 'better';
  }

  const comparison = {
    subject: subject.name,
    against: against.name,
    confidence,
    absolute,
    relative,
    change,
  };
  return { ...comparison, severity: severityOf(comparison, definition) };
}

/** The pairs a benchmark's kind compares: the current build against the baseline, or every variant against the reference. */
function pairsOf(benchmark: RunBenchmark): Array<{ subject: string; against: string }> {
  const [reference, ...others] = benchmark.variants;
  return benchmark.kind === 'baseline'
    ? others.map((other) => ({ subject: reference, against: other }))
    : others.map((other) => ({ subject: other, against: reference }));
}

export type MetricComparisons = Omit<MetricAnalysis, 'variants'>;

interface PairedMetric {
  metric: string;
  definition: RunMetricDefinition;
  canAlarm: boolean;
  pairs: Array<{
    subject: { name: string; values: number[] };
    against: { name: string; values: number[] };
  }>;
}

/** Every metric a benchmark reported, with the pairs of variants its kind compares on it. */
function pairedMetricsOf(
  metrics: Record<string, RunMetricDefinition>,
  benchmark: RunBenchmark,
): PairedMetric[] {
  const { samples } = benchmark;
  const [reference] = benchmark.variants;
  return Object.keys(samples?.[reference] ?? {}).map((metric) => {
    const definition = definitionOf(metrics, metric);
    const sideOf = (name: string) => ({ name, values: samples?.[name]?.[metric] ?? [] });
    return {
      metric,
      definition,
      canAlarm: benchmark.kind === 'baseline' && definition.alarm !== undefined,
      pairs: pairsOf(benchmark).map(({ subject, against }) => ({
        subject: sideOf(subject),
        against: sideOf(against),
      })),
    };
  });
}

/**
 * How many comparisons share the run's 5% chance of a false alarm: those that can raise an alarm —
 * alarmed metrics of `baseline` benchmarks — leaving out any whose per-round differences never
 * varied. Those can't be flagged by chance — a render count that is the same in every round — so
 * they would only make the others stricter.
 */
export function countAlarmedComparisons(
  metrics: Record<string, RunMetricDefinition>,
  benchmarks: RunBenchmark[],
): number {
  return benchmarks
    .flatMap((benchmark) => pairedMetricsOf(metrics, benchmark))
    .filter((paired) => paired.canAlarm)
    .flatMap((paired) => paired.pairs)
    .filter(({ subject, against }) => {
      const differences = differencesOf(subject.values, against.values);
      return differences.some((difference) => difference !== differences[0]);
    }).length;
}

/**
 * Compares one benchmark's variants, its metrics described by `metrics` (a report's, or a run's so
 * far). The comparisons alone, which is all deciding whether to keep sampling needs. A comparison
 * that can raise an alarm is one of `familySize` sharing the run's 5% chance of a false one.
 */
export function compareBenchmark(
  metrics: Record<string, RunMetricDefinition>,
  benchmark: RunBenchmark,
  familySize = 1,
): { metrics: MetricComparisons[] } {
  return {
    metrics: pairedMetricsOf(metrics, benchmark).map(({ metric, definition, canAlarm, pairs }) => {
      const confidence = canAlarm ? alarmedConfidence(familySize) : CONFIDENCE;
      return {
        metric,
        definition,
        comparisons: pairs.map(({ subject, against }) =>
          compareSamples(subject, against, definition, confidence),
        ),
      };
    }),
  };
}

/** Analyses one benchmark: its comparisons, and a summary of each variant's samples. */
export function analyzeBenchmark(
  metrics: Record<string, RunMetricDefinition>,
  benchmark: RunBenchmark,
  familySize = 1,
): BenchmarkAnalysis {
  const { samples } = benchmark;
  return {
    benchmark,
    metrics: compareBenchmark(metrics, benchmark, familySize).metrics.map((comparison) => ({
      ...comparison,
      variants: Object.fromEntries(
        benchmark.variants.map((variant) => [
          variant,
          summarizeSamples(samples?.[variant]?.[comparison.metric] ?? []),
        ]),
      ),
    })),
  };
}

export function analyzeRun(report: BenchmarkRunReport): BenchmarkAnalysis[] {
  const familySize = countAlarmedComparisons(report.metrics, report.benchmarks);
  return report.benchmarks.map((benchmark) =>
    analyzeBenchmark(report.metrics, benchmark, familySize),
  );
}

export interface Regression {
  benchmark: string;
  metric: string;
  comparison: MetricComparison;
}

/**
 * The changes that say something is wrong with the code under test: only a `baseline` benchmark
 * measures that, and only an alarmed metric's change for the worse counts.
 */
export function findRegressions(analyses: BenchmarkAnalysis[]): Regression[] {
  return analyses.flatMap(({ benchmark, metrics }) =>
    benchmark.kind !== 'baseline'
      ? []
      : metrics.flatMap(({ metric, comparisons }) =>
          comparisons
            .filter((comparison) => comparison.severity !== 'none')
            .map((comparison) => ({ benchmark: benchmark.name, metric, comparison })),
        ),
  );
}

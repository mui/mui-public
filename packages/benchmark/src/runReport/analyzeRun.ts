import { calculateMean, quantile } from '../stats';
import type { BenchmarkRunReport, RunBenchmark, RunMetricDefinition } from './schema';

/**
 * The one analysis of a run report, shared by the runner's table, the pull request comment and the
 * dashboard, so they cannot disagree about what a run found.
 *
 * Variants are compared on paired differences: each round measured every variant once, so the
 * per-round difference cancels whatever the machine was doing during that round, and its
 * confidence interval is far tighter than one computed from two independent sets of samples.
 */

export interface Interval {
  low: number;
  high: number;
}

export interface SampleSummary {
  count: number;
  median: number;
  /** 95% confidence interval of the mean. */
  mean: Interval;
}

/** Which way a resolved change went, given the metric's direction; `unsure` if it did not resolve. */
export type Change = 'better' | 'worse' | 'unsure';

/** How much a change for the worse matters, per the metric's alarm. */
export type Severity = 'error' | 'warning' | 'none';

export interface MetricComparison {
  /** The variant the difference is about. */
  subject: string;
  /** The variant it is measured against. */
  against: string;
  /** `subject − against`, in the metric's unit: 95% confidence interval of the mean difference. */
  absolute: Interval;
  /** The same, as a percentage of `against`'s mean. */
  relative: Interval;
  change: Change;
  severity: Severity;
  /** Rounds both variants were measured in. */
  rounds: number;
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

// Two-sided 95% critical values of Student's t for 1–30 degrees of freedom.
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];

/** The two-sided 95% critical value of Student's t, approximated past the table. */
export function tCritical95(degreesOfFreedom: number): number {
  if (degreesOfFreedom <= T_95.length) {
    return T_95[Math.max(degreesOfFreedom, 1) - 1];
  }
  // Cornish–Fisher expansion around the normal quantile; well within 0.1% past 30 degrees.
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * degreesOfFreedom);
}

/** The 95% confidence interval of the mean. A single value is its own degenerate interval. */
export function meanInterval(values: number[]): Interval {
  const mean = calculateMean(values);
  if (values.length < 2) {
    return { low: mean, high: mean };
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const halfWidth = tCritical95(values.length - 1) * Math.sqrt(variance / values.length);
  return { low: mean - halfWidth, high: mean + halfWidth };
}

export function median(values: number[]): number {
  return quantile(
    [...values].sort((left, right) => left - right),
    0.5,
  );
}

function summarizeSamples(values: number[]): SampleSummary {
  return { count: values.length, median: median(values), mean: meanInterval(values) };
}

const DEFAULT_DEFINITION: RunMetricDefinition = { kind: 'scalar' };

/** A metric's definition; a `name#id` sub-series is defined by its base metric. */
function definitionOf(report: BenchmarkRunReport, metric: string): RunMetricDefinition {
  const [base] = metric.split('#');
  return report.metrics[metric] ?? report.metrics[base] ?? DEFAULT_DEFINITION;
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

export function compareSamples(
  subject: { name: string; values: number[] },
  against: { name: string; values: number[] },
  definition: RunMetricDefinition,
): MetricComparison {
  const rounds = Math.min(subject.values.length, against.values.length);
  const differences = Array.from(
    { length: rounds },
    (_, round) => subject.values[round] - against.values[round],
  );
  const absolute = meanInterval(differences);
  const reference = calculateMean(against.values.slice(0, rounds));
  const relative = {
    low: (absolute.low / reference) * 100,
    high: (absolute.high / reference) * 100,
  };

  let change: Change = 'unsure';
  if (absolute.low > 0 || absolute.high < 0) {
    const increased = absolute.low > 0;
    const lowerIsBetter = definition.alarm?.direction !== 'higherIsBetter';
    change = increased === lowerIsBetter ? 'worse' : 'better';
  }

  const comparison = { subject: subject.name, against: against.name, absolute, relative, change };
  return { ...comparison, severity: severityOf(comparison, definition), rounds };
}

/** The pairs a benchmark's kind compares: the current build against the baseline, or every variant against the reference. */
function pairsOf(benchmark: RunBenchmark): Array<{ subject: string; against: string }> {
  const [reference, ...others] = benchmark.variants;
  return benchmark.kind === 'baseline'
    ? others.map((other) => ({ subject: reference, against: other }))
    : others.map((other) => ({ subject: other, against: reference }));
}

function analyzeBenchmark(report: BenchmarkRunReport, benchmark: RunBenchmark): BenchmarkAnalysis {
  const { samples } = benchmark;
  if (!samples) {
    return { benchmark, metrics: [] };
  }
  const [reference] = benchmark.variants;
  const metricNames = Object.keys(samples[reference] ?? {});

  const metrics = metricNames.map((metric): MetricAnalysis => {
    const definition = definitionOf(report, metric);
    const valuesOf = (variant: string) => samples[variant]?.[metric] ?? [];
    return {
      metric,
      definition,
      variants: Object.fromEntries(
        benchmark.variants.map((variant) => [variant, summarizeSamples(valuesOf(variant))]),
      ),
      comparisons: pairsOf(benchmark).map(({ subject, against }) =>
        compareSamples(
          { name: subject, values: valuesOf(subject) },
          { name: against, values: valuesOf(against) },
          definition,
        ),
      ),
    };
  });
  return { benchmark, metrics };
}

export function analyzeRun(report: BenchmarkRunReport): BenchmarkAnalysis[] {
  return report.benchmarks.map((benchmark) => analyzeBenchmark(report, benchmark));
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

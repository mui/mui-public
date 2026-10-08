import { analyzeRun, findRegressions } from './analyzeRun';
import type { Change, Interval, Severity } from './analyzeRun';
import type { BenchmarkRunReport, RunBenchmark } from './schema';

/**
 * A run's conclusions as plain data, for a program to read rather than a person: what the tables,
 * the pull request comment and the dashboard show, without the raw samples behind it.
 */
export interface RunSummary {
  /** How long the whole run took, when the report says. */
  durationMs?: number;
  /** The changes for the worse that fail the check, as the comment lists them. */
  regressions: Array<{ benchmark: string; metric: string; relative: Interval }>;
  benchmarks: BenchmarkSummary[];
}

export interface BenchmarkSummary {
  name: string;
  file: string;
  kind: RunBenchmark['kind'];
  /** Rounds measured; absent for a benchmark that failed. */
  rounds?: number;
  timedOut?: boolean;
  durationMs?: number;
  error?: string;
  metrics: Array<{
    metric: string;
    /** Per variant, the median of its samples. */
    medians: Record<string, number>;
    comparisons: Array<{
      subject: string;
      against: string;
      change: Change;
      severity: Severity;
      /** `subject − against`, in the metric's unit. */
      absolute: Interval;
      /** The same, as a percentage of `against`. */
      relative: Interval;
    }>;
  }>;
}

export function summarizeRun(report: BenchmarkRunReport): RunSummary {
  const analyses = analyzeRun(report);
  return {
    durationMs: report.durationMs,
    regressions: findRegressions(analyses).map(({ benchmark, metric, comparison }) => ({
      benchmark,
      metric,
      relative: comparison.relative,
    })),
    benchmarks: analyses.map(({ benchmark, metrics }) => {
      const [reference] = benchmark.variants;
      return {
        name: benchmark.name,
        file: benchmark.file,
        kind: benchmark.kind,
        rounds: Object.values(benchmark.samples?.[reference] ?? {})[0]?.length,
        timedOut: benchmark.sampling?.timedOut,
        durationMs: benchmark.durationMs,
        error: benchmark.error,
        metrics: metrics.map(({ metric, variants, comparisons }) => ({
          metric,
          medians: Object.fromEntries(
            Object.entries(variants).map(([variant, summary]) => [variant, summary.median]),
          ),
          comparisons: comparisons.map(
            ({ subject, against, change, severity, absolute, relative }) => ({
              subject,
              against,
              change,
              severity,
              absolute,
              relative,
            }),
          ),
        })),
      };
    }),
  };
}

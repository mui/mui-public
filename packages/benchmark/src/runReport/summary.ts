import { analyzeRun, findRegressions, isTie } from './analyzeRun';
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
      /** Whether the change is for the better past the alarm's band. */
      improved: boolean;
      /** `subject − against`, in the metric's unit. */
      absolute: Interval;
      /** The same, as a percentage of `against`. */
      relative: Interval;
    }>;
  }>;
  /** A `compare()`'s cases, best first, on its first metric. */
  ranking?: {
    metric: string;
    cases: Array<{
      variant: string;
      median: number;
      /** How many times the best case's median it is; `null` when the best measured 0. */
      ratio: number | null;
      /** Whether it can't be told apart from the case ranked just above it. */
      tie: boolean;
      /** Against the case ranked just above it, as a percentage of that case; absent for the best. */
      relativeToNext?: Interval;
    }>;
  };
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
    benchmarks: analyses.map(({ benchmark, metrics, ranking }) => {
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
            ({ subject, against, change, severity, improved, absolute, relative }) => ({
              subject,
              against,
              change,
              severity,
              improved,
              absolute,
              relative,
            }),
          ),
        })),
        ...(ranking
          ? {
              ranking: {
                metric: ranking.metric,
                cases: ranking.cases.map((rankedCase) => ({
                  variant: rankedCase.variant,
                  median: rankedCase.median,
                  ratio: rankedCase.ratio,
                  tie: isTie(rankedCase),
                  ...(rankedCase.vsNext ? { relativeToNext: rankedCase.vsNext.relative } : {}),
                })),
              },
            }
          : {}),
      };
    }),
  };
}

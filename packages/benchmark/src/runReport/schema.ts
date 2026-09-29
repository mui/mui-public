import { z } from 'zod/v4';

/**
 * The report `benchmark run` produces, uploads and the dashboard reads: version 2 of the `benchmark`
 * report, which the Vitest reporter uploads as version 1. A repository uploads one or the other, and
 * the dashboard reads each by its version.
 *
 * It holds raw samples rather than conclusions: every variant of a benchmark is sampled once per
 * round, and index `i` of every sample array is round `i`, so any statistic — paired differences
 * included — can be computed from the report later, by whichever reader needs it, without running
 * the benchmarks again. `analyzeRun` is the one analysis the runner and the dashboard share.
 *
 * Pure and node-free, so a browser can import it.
 */

/**
 * The same shape a metric's `alarm` config has. `warn` and `error` are the smallest changes that
 * count at each level — a relative fraction (`0.1` = 10%) for a scalar metric, an absolute count
 * for a discrete one. With both omitted, any resolved change for the worse is an error.
 */
const alarmSchema = z.object({
  direction: z.enum(['lowerIsBetter', 'higherIsBetter']).optional(),
  warn: z.number().min(0).optional(),
  error: z.number().min(0).optional(),
});

const metricDefinitionSchema = z.object({
  kind: z.enum(['scalar', 'discrete']),
  format: z.custom<Intl.NumberFormatOptions>().optional(),
  /** Present when a change in this metric is a regression; without it the metric is informational. */
  alarm: alarmSchema.optional(),
});

/** A build the benchmark pages were loaded from. */
const buildSchema = z.object({
  /** The commit it was built from; absent for the working tree. */
  sha: z.string().optional(),
  /** How the run was given it: `working tree`, `HEAD~1`, a tag, a SHA. */
  label: z.string(),
});

const benchmarkSchema = z.object({
  name: z.string(),
  /** The `*.bench.tsx` file it is defined in, relative to the harness's `src/`. */
  file: z.string(),
  /**
   * `baseline` measures one benchmark across the run's builds — `current` against `baseline` — so a
   * difference is a change made by the code under test. `compare` measures the variants of a
   * `compare()` against each other on the current build, where a difference is the point.
   */
  kind: z.enum(['baseline', 'compare']),
  /** Variant names, the reference first: `current` for `baseline`, the first variant for `compare`. */
  variants: z.array(z.string()),
  /** Per variant, per metric: one value per round, round-aligned across variants and metrics. */
  samples: z.record(z.string(), z.record(z.string(), z.array(z.number()))).optional(),
  /** Why the benchmark produced no samples. */
  error: z.string().optional(),
});

export const benchmarkRunReportSchema = z.object({
  version: z.literal(2),
  generatedAt: z.string(),
  head: z.object({ sha: z.string(), branch: z.string().optional() }),
  environment: z.object({
    browser: z.string(),
    platform: z.string(),
    arch: z.string(),
    launchArgs: z.array(z.string()),
  }),
  sampling: z.object({ samples: z.number(), warmup: z.number() }),
  /** What the `baseline`-kind variant names refer to. */
  builds: z.record(z.string(), buildSchema),
  /** Every metric the benchmarks report, keyed by name; `name#id` sub-series share `name`'s entry. */
  metrics: z.record(z.string(), metricDefinitionSchema),
  benchmarks: z.array(benchmarkSchema),
});

export type BenchmarkRunReport = z.infer<typeof benchmarkRunReportSchema>;

/** The version 2 `benchmark.json` as the dashboard stores it: the upload envelope around the report. */
export interface BenchmarkRunUpload {
  version: 2;
  timestamp: number;
  commitSha: string;
  repo: string;
  reportType: 'benchmark';
  prNumber?: number;
  branch: string;
  report: BenchmarkRunReport;
}
export type RunMetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type RunBenchmark = z.infer<typeof benchmarkSchema>;
export type RunBuild = z.infer<typeof buildSchema>;

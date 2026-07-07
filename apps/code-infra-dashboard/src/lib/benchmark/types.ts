/**
 * Types mirroring @mui/internal-benchmark/ciReport
 * Defined inline since the benchmark package is not in this workspace.
 *
 * To fetch a benchmark report, use:
 *   fetchCiReport(repo, sha, 'benchmark.json')
 */
export interface RenderStats {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  startTime: number;
  actualDuration: number;
  stdDev: number;
  rawMean: number;
  rawStdDev: number;
  outliers: number;
  /** Effective sample count behind mean/stdDev; the `n` for Welch's t-test. Absent on old uploads. */
  count?: number;
}

export interface MetricStats {
  mean: number;
  stdDev: number;
  outliers: number;
  /** Effective sample count behind mean/stdDev; the `n` for Welch's t-test. Absent on old uploads. */
  count?: number;
}

export interface BenchmarkReportEntry {
  iterations: number;
  totalDuration: number;
  renders: RenderStats[];
  metrics: Record<string, MetricStats>;
}

export type BenchmarkReport = Record<string, BenchmarkReportEntry>;

export type MetricDirection = 'lowerIsBetter' | 'higherIsBetter';

export interface MetricAlarm {
  direction?: MetricDirection;
  /** Softer band (relative fraction for scalar, absolute count delta for discrete). */
  warn?: number;
  /** Harder band; defaults to the global noise band only when both `warn` and `error` are omitted. */
  error?: number;
}

/** Per-metric config for custom metrics, hoisted to the top level of the report (keyed by name). */
export interface MetricDefinition {
  kind: 'scalar' | 'discrete';
  format?: Intl.NumberFormatOptions;
  alarm?: MetricAlarm;
}

export interface BenchmarkBaseUpload {
  version: 1;
  timestamp: number;
  commitSha: string;
  repo: string;
  reportType: 'benchmark';
  prNumber?: number;
  branch: string;
  report: BenchmarkReport;
  metricDefinitions?: Record<string, MetricDefinition>;
}

export interface BenchmarkUpload extends BenchmarkBaseUpload {
  base?: BenchmarkBaseUpload;
}

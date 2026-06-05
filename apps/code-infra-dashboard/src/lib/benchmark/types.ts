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
}

export interface MetricStats {
  mean: number;
  stdDev: number;
  outliers: number;
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
  threshold?: number;
}

/** Per-metric config for custom metrics, hoisted to the top level of the report (keyed by name). */
export interface MetricDefinition {
  kind: 'scalar' | 'discrete';
  format?: Intl.NumberFormatOptions;
  alarm?: MetricAlarm;
  group?: string;
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

import { fetchCiReport } from './fetchCiReport';

/**
 * Types mirroring @mui/internal-benchmark/ciReport
 * Defined inline since the benchmark package is not in this workspace.
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

export interface BenchmarkReportEntry {
  iterations: number;
  totalDuration: number;
  renders: RenderStats[];
}

export type BenchmarkReport = Record<string, BenchmarkReportEntry>;

/**
 * Fetches a benchmark report from S3 for a given repo and commit SHA.
 * Returns `null` when the report does not exist.
 */
export async function fetchBenchmarkReport(
  repo: string,
  sha: string,
): Promise<BenchmarkReport | null> {
  return fetchCiReport<BenchmarkReport>(repo, sha, 'benchmark.json');
}

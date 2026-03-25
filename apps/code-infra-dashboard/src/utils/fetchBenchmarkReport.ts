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
 */
export async function fetchBenchmarkReport(repo: string, sha: string): Promise<BenchmarkReport> {
  const url = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${repo}/${sha}/benchmark.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch benchmark report: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

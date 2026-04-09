import type { SizeSnapshot } from '@/lib/bundleSize/fetchSnapshot';
import type { BenchmarkReport } from './fetchBenchmarkReport';

export interface CiReportTypes {
  'benchmark.json': BenchmarkReport;
  'size-snapshot.json': SizeSnapshot;
}

export type CiReportName = keyof CiReportTypes;

/**
 * Fetches a CI report JSON from S3 for a given repo and commit SHA.
 * Returns `null` when the report does not exist (S3 returns 403 for missing objects).
 */
export async function fetchCiReport<K extends keyof CiReportTypes>(
  repo: string,
  sha: string,
  reportName: K,
): Promise<CiReportTypes[K] | null> {
  const url = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${repo}/${sha}/${reportName}`;
  const response = await fetch(url);

  if (response.status === 403 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch CI report: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

import type { SizeSnapshotWithMetadata } from '@/lib/bundleSize/types';
import type { BenchmarkReport, BenchmarkUpload } from '@/lib/benchmark/types';

export interface CiReportTypes {
  'benchmark.json': BenchmarkUpload;
  'size-snapshot.json': SizeSnapshotWithMetadata;
}

export type CiReportName = keyof CiReportTypes;

/**
 * Legacy artifacts uploaded before the wrapper change store a flat
 * `Record<string, BenchmarkReportEntry>`. Wrap them so downstream consumers
 * can read `.report` uniformly. The S3 path already committed us to a
 * specific sha/repo, so inject those into the returned wrapper — for legacy
 * artifacts this fills in missing metadata, for new-shape artifacts it
 * simply reasserts what the body already contains.
 */
function normalizeBenchmarkArtifact(raw: unknown, repo: string, sha: string): BenchmarkUpload {
  if (raw && typeof raw === 'object' && 'report' in raw) {
    return { ...(raw as BenchmarkUpload), commitSha: sha, repo };
  }
  return {
    commitSha: sha,
    repo,
    report: raw as BenchmarkReport,
  } as BenchmarkUpload;
}

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

  const data: unknown = await response.json();

  if (reportName === 'benchmark.json') {
    return normalizeBenchmarkArtifact(data, repo, sha) as CiReportTypes[K];
  }

  return data as CiReportTypes[K];
}

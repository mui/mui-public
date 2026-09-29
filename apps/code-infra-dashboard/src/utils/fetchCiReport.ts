import type { SizeSnapshotWithMetadata } from '@/lib/bundleSize/types';
import type { BenchmarkReport, BenchmarkUpload } from '@/lib/benchmark/types';
import type { BenchmarkRunUpload } from '@mui/internal-benchmark/runReport';
import type { TachometerReport } from '@mui/internal-benchmark/tachometerReport';
import { migrateBenchmarkReport } from '@/lib/benchmark/migrateBenchmarkReport';

export interface CiReportTypes {
  /**
   * Version 1 from the Vitest reporter, or version 2 from `benchmark run`: a repository uploads one or
   * the other while it moves over, so every reader narrows on `version`.
   */
  'benchmark.json': BenchmarkUpload | BenchmarkRunUpload;
  'size-snapshot.json': SizeSnapshotWithMetadata;
  'tachometer.json': TachometerReport;
}

export type CiReportName = keyof CiReportTypes;

/** Whether a `benchmark.json` is the version 2 report `benchmark run` uploads. */
export function isBenchmarkRunUpload(
  upload: BenchmarkUpload | BenchmarkRunUpload,
): upload is BenchmarkRunUpload {
  return upload.version === 2;
}

/**
 * Legacy artifacts uploaded before the wrapper change store a flat
 * `Record<string, BenchmarkReportEntry>`. Wrap them so downstream consumers
 * can read `.report` uniformly. The S3 path already committed us to a
 * specific sha/repo, so inject those into the returned wrapper — for legacy
 * artifacts this fills in missing metadata, for new-shape artifacts it
 * simply reasserts what the body already contains. A version 2 artifact needs none of it.
 */
function normalizeBenchmarkArtifact(
  raw: unknown,
  repo: string,
  sha: string,
): BenchmarkUpload | BenchmarkRunUpload {
  if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 2) {
    return { ...(raw as BenchmarkRunUpload), commitSha: sha, repo };
  }
  const upload: BenchmarkUpload =
    raw && typeof raw === 'object' && 'report' in raw
      ? { ...(raw as BenchmarkUpload), commitSha: sha, repo }
      : ({ commitSha: sha, repo, report: raw as BenchmarkReport } as BenchmarkUpload);

  // Apply forward migrations so older uploads read with the current metric naming.
  return {
    ...upload,
    report: migrateBenchmarkReport(upload.report),
    ...(upload.base
      ? { base: { ...upload.base, report: migrateBenchmarkReport(upload.base.report) } }
      : {}),
  };
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

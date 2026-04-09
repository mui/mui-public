import { fetchCiReport, type CiReportName, type CiReportTypes } from '@/utils/fetchCiReport';
import { getOctokit } from '@/lib/github';

/**
 * Fetches parent commit SHAs for a given commit using the GitHub API.
 * Returns up to `depth` parent commit SHAs (excluding the commit itself).
 */
export async function fetchParentCommits(
  repo: string,
  sha: string,
  depth: number,
): Promise<string[]> {
  const [owner, repoName] = repo.split('/');
  const octokit = getOctokit();

  const { data: commits } = await octokit.repos.listCommits({
    owner,
    repo: repoName,
    sha,
    per_page: depth + 1,
  });

  // Skip the first commit (it's the commit itself), take the rest
  return commits.slice(1).map((c) => c.sha);
}

/**
 * Fetches a CI report from S3, trying each candidate SHA in order.
 * Returns the report and the commit it was found at, or `null` values
 * if no report could be found for any candidate.
 */
export async function fetchCiReportWithFallback<K extends CiReportName>(
  repo: string,
  candidates: string[],
  reportName: K,
): Promise<{ report: CiReportTypes[K] | null; actualCommit: string | null }> {
  for (const sha of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const report = await fetchCiReport(repo, sha, reportName);
    if (report) {
      return { report, actualCommit: sha };
    }
  }

  return { report: null, actualCommit: null };
}

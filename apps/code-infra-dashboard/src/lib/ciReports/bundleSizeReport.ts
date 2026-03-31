import {
  calculateSizeDiff,
  fetchSnapshot,
  renderMarkdownReportContent,
} from '@mui/internal-bundle-size-checker/browser';
import { getOctokit } from '@/lib/github';
import { DASHBOARD_ORIGIN } from '@/constants';

/**
 * Fetches a snapshot, trying parent commits as fallback when the base snapshot is missing.
 * Uses GitHub API to get parent commit SHAs instead of git CLI.
 */
async function fetchSnapshotWithFallback(
  repo: string,
  commit: string,
  fallbackDepth: number,
): Promise<{
  snapshot: Record<string, { parsed: number; gzip: number }> | null;
  actualCommit: string | null;
}> {
  try {
    const snapshot = await fetchSnapshot(repo, commit);
    return { snapshot, actualCommit: commit };
  } catch {
    // fallthrough to parent commits
  }

  const [owner, repoName] = repo.split('/');
  const octokit = getOctokit();

  let parentCommits: string[];
  try {
    const { data: commits } = await octokit.repos.listCommits({
      owner,
      repo: repoName,
      sha: commit,
      per_page: fallbackDepth + 1,
    });
    // Skip the first commit (it's the commit itself), take the rest
    parentCommits = commits.slice(1).map((c) => c.sha);
  } catch {
    return { snapshot: null, actualCommit: null };
  }

  for (const parentCommit of parentCommits) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await fetchSnapshot(repo, parentCommit);
      return { snapshot, actualCommit: parentCommit };
    } catch {
      // fallthrough to the next parent commit
    }
  }

  return { snapshot: null, actualCommit: null };
}

function getDetailsUrl(
  repo: string,
  prNumber: number,
  baseRef: string,
  baseCommit: string,
  headCommit: string,
) {
  const url = new URL(`${DASHBOARD_ORIGIN}/size-comparison/${repo}/diff`);
  url.searchParams.set('prNumber', String(prNumber));
  url.searchParams.set('baseRef', baseRef);
  url.searchParams.set('baseCommit', baseCommit);
  url.searchParams.set('headCommit', headCommit);
  return url;
}

interface PrInfo {
  base: { sha: string; ref: string };
}

interface BundleSizeReportOptions {
  repo: string;
  prNumber: number;
  commitSha: string;
  pr: PrInfo;
  trackedBundles?: string[];
}

export interface BundleSizeReportResult {
  content: string;
}

/**
 * Generates a pending bundle size report section.
 */
export function generatePendingBundleSizeReport(): string {
  return '## Bundle size report\n\nBundle size will be reported once the build finishes.\n\nStatus: 🟠 Processing...';
}

/**
 * Generates a complete bundle size report by fetching and comparing snapshots.
 * Returns null if the head snapshot is not available.
 */
export async function generateBundleSizeReport(
  options: BundleSizeReportOptions,
): Promise<BundleSizeReportResult | null> {
  const { repo, prNumber, commitSha, pr, trackedBundles } = options;
  const fallbackDepth = 3;

  const [owner, repoName] = repo.split('/');
  const octokit = getOctokit();
  let mergeBaseCommit: string;
  try {
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo: repoName,
      base: pr.base.sha,
      head: commitSha,
    });
    mergeBaseCommit = data.merge_base_commit.sha;
  } catch (error) {
    console.error('Failed to get merge base:', error);
    mergeBaseCommit = pr.base.sha;
  }

  const [baseResult, headSnapshot] = await Promise.all([
    fetchSnapshotWithFallback(repo, mergeBaseCommit, fallbackDepth),
    fetchSnapshot(repo, commitSha).catch(() => null),
  ]);

  if (!headSnapshot) {
    return null;
  }

  const { snapshot: baseSnapshot, actualCommit: actualBaseCommit } = baseResult;

  let markdownContent = '';

  if (!baseSnapshot) {
    markdownContent += `_:no_entry_sign: No bundle size snapshot found for merge base ${mergeBaseCommit} or any of its ${fallbackDepth} parent commits._\n\n`;
  } else if (actualBaseCommit !== mergeBaseCommit) {
    markdownContent += `_:information_source: Using snapshot from parent commit ${actualBaseCommit} (fallback from merge base ${mergeBaseCommit})._\n\n`;
  }

  const sizeDiff = calculateSizeDiff(baseSnapshot ?? {}, headSnapshot);
  const report = renderMarkdownReportContent(sizeDiff, {
    track: trackedBundles && trackedBundles.length > 0 ? trackedBundles : undefined,
  });

  markdownContent += report;

  const detailsUrl = getDetailsUrl(
    repo,
    prNumber,
    pr.base.ref,
    actualBaseCommit || mergeBaseCommit,
    commitSha,
  );
  markdownContent += `\n\n[Details of bundle changes](${detailsUrl})`;

  return { content: `## Bundle size report\n\n${markdownContent}` };
}

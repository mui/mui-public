import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import {
  calculateSizeDiff,
  fetchSnapshot,
  renderMarkdownReportContent,
} from '@mui/internal-bundle-size-checker/browser';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { verifyPr } from '@/lib/ciReports/verifyPr';
import { upsertPrComment } from '@/lib/ciReports/prComment';
import { getOctokit } from '@/lib/github';

const DASHBOARD_ORIGIN = 'https://frontend-public.mui.com';

const syncPrCommentSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  prNumber: z.number().int().positive(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  trackedBundles: z.array(z.string()).optional(),
  buildUrl: z.string().url().optional(),
  status: z.enum(['pending', 'complete']),
});

function formatComment(repo: string, prNumber: number, bundleSizeInfo: string) {
  return [
    '## Bundle size report',
    bundleSizeInfo,
    '<hr>',
    `Check out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${repo}/prs/${prNumber}) for more information about this PR.`,
  ].join('\n\n');
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

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  let oidcResult;
  try {
    oidcResult = await verifyOidcToken(authHeader.slice(7));
  } catch (error) {
    console.error('OIDC token verification failed:', error);
    return NextResponse.json({ error: 'Invalid OIDC token' }, { status: 401 });
  }

  // eslint-disable-next-line no-console
  console.log('OIDC verification result:', {
    provider: oidcResult.provider,
    sourceRepo: oidcResult.sourceRepo,
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = syncPrCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { repo, prNumber, commitSha, trackedBundles, buildUrl, status } = parsed.data;

  let prResult;
  try {
    prResult = await verifyPr(oidcResult.sourceRepo, prNumber);
  } catch (error) {
    console.error(`PR verification failed for #${prNumber}:`, error);
    return NextResponse.json(
      {
        error: `Could not verify PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 403 },
    );
  }

  const { pr } = prResult;

  if (status === 'pending') {
    const buildLink = buildUrl ? ` [build](${buildUrl})` : '';
    const pendingContent = formatComment(
      repo,
      prNumber,
      `Bundle size will be reported once the${buildLink} finishes.\n\nStatus: 🟠 Processing...`,
    );
    await upsertPrComment(repo, prNumber, 'bundle-size-report', pendingContent);
    return NextResponse.json({ success: true });
  }

  // status === 'complete': generate the full report
  const fallbackDepth = 3;

  // Get merge base via GitHub API
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
    return NextResponse.json(
      { error: `No bundle size snapshot found for commit ${commitSha}` },
      { status: 422 },
    );
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

  const commentBody = formatComment(repo, prNumber, markdownContent);
  await upsertPrComment(repo, prNumber, 'bundle-size-report', commentBody);

  return NextResponse.json({ success: true });
}

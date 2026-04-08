import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';
import { upsertPrComment } from '@/lib/ciReports/prComment';
import { generateBundleSizeReport } from '@/lib/ciReports/bundleSizeReport';
import { generateBenchmarkReport } from '@/lib/ciReports/benchmarkReport';
import { fetchParentCommits } from '@/lib/ciReports/fetchWithFallback';
import { getOctokit } from '@/lib/github';
import { DASHBOARD_ORIGIN } from '@/constants';

const syncPrCommentSchema = z.object({
  repo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format')
    .optional(),
});

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

  const { repo } = parsed.data;

  if (!oidcResult.isTrusted && !repo) {
    return NextResponse.json({ error: 'Fork builds must include a repo field' }, { status: 400 });
  }

  // For trusted builds, ignore the repo field — use the source repo from OIDC claims
  const targetRepo = oidcResult.isTrusted ? undefined : repo;

  let pr;
  try {
    pr = await findAssociatedPr(oidcResult, { targetRepo });
  } catch (error) {
    console.error('PR lookup failed:', error);
    return NextResponse.json(
      {
        error: `Could not find associated PR: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 403 },
    );
  }

  if (!pr) {
    // No PR found for this branch — not an error, just nothing to do
    return NextResponse.json({ success: true, skipped: true });
  }

  const prRepo = pr.base.repo.full_name as string;
  const commitSha = pr.head.sha;

  // Compute merge base and parent candidates once, shared across all report types
  const [owner, repoName] = prRepo.split('/');
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

  let baseCandidates: string[];
  try {
    baseCandidates = [mergeBaseCommit, ...(await fetchParentCommits(prRepo, mergeBaseCommit, 3))];
  } catch {
    baseCandidates = [mergeBaseCommit];
  }

  const reportOptions = {
    repo: prRepo,
    prNumber: pr.number,
    commitSha,
    pr,
    baseCandidates,
  };

  // Generate all report sections in parallel
  const [bundleSizeReport, benchmarkReportResult] = await Promise.all([
    generateBundleSizeReport(reportOptions),
    generateBenchmarkReport(reportOptions),
  ]);

  const commentSections: Record<string, string> = {};

  commentSections.bundleSize =
    bundleSizeReport?.content ??
    `## Bundle size report\n\n:warning: No bundle size snapshot found for commit ${commitSha}.`;

  commentSections.benchmark =
    benchmarkReportResult?.content ??
    `## Benchmark report\n\n:warning: No benchmark report found for commit ${commitSha}.`;

  await upsertPrComment(prRepo, pr.number, commentSections, {
    footer: `<hr>\n\nCheck out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${prRepo}/prs/${pr.number}) for more information about this PR.`,
  });

  return NextResponse.json({ success: true });
}

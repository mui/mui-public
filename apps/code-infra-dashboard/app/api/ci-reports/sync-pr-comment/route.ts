import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';
import { upsertPrComment } from '@/lib/ciReports/prComment';
import {
  generateBundleSizeReport,
  BUNDLE_SIZE_SECTION_TITLE,
} from '@/lib/ciReports/bundleSizeReport';
import { generateBenchmarkReport, BENCHMARK_SECTION_TITLE } from '@/lib/ciReports/benchmarkReport';
import { generateDeployPreviewReport } from '@/lib/ciReports/deployPreviewReport';
import type { ReportResult } from '@/lib/ciReports/types';
import { fetchParentCommits } from '@/utils/fetchCiReportWithFallback';
import { getOctokit } from '@/lib/github';
import { DASHBOARD_ORIGIN, repositories } from '@/constants';

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

  let mergeBaseCommit = pr.base.sha;
  try {
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo: repoName,
      base: pr.base.sha,
      head: commitSha,
    });
    mergeBaseCommit = comparison.merge_base_commit.sha;
  } catch (error) {
    console.error('Failed to compare commits for merge-base computation:', error);
  }

  let baseCandidates: string[];
  try {
    baseCandidates = [mergeBaseCommit, ...(await fetchParentCommits(prRepo, mergeBaseCommit, 3))];
  } catch {
    baseCandidates = [mergeBaseCommit];
  }

  const repoConfig = repositories.get(prRepo);
  const prCommentConfig = repoConfig?.prComment;

  const reportOptions = {
    repo: prRepo,
    prNumber: pr.number,
    commitSha,
    pr,
    baseCandidates,
  };

  // Generate all configured report sections in parallel.
  // Each generator is wrapped in .catch() so a failure in one doesn't block the others.
  const [bundleSizeReport, benchmarkReportResult, deployPreviewReport] = await Promise.all([
    prCommentConfig?.bundleSize
      ? generateBundleSizeReport(reportOptions).catch((error): ReportResult => {
          console.error('Failed to generate bundle size report:', error);
          return {
            content: `## ${BUNDLE_SIZE_SECTION_TITLE}\n\n:warning: Failed to generate bundle size report.`,
          };
        })
      : null,
    prCommentConfig?.benchmark
      ? generateBenchmarkReport(reportOptions).catch((error): ReportResult => {
          console.error('Failed to generate benchmark report:', error);
          return {
            content: `## ${BENCHMARK_SECTION_TITLE}\n\n:warning: Failed to generate benchmark report.`,
          };
        })
      : null,
    prCommentConfig?.netlifyDocs
      ? generateDeployPreviewReport(reportOptions).catch((error): ReportResult => {
          console.error('Failed to generate deploy preview report:', error);
          return {
            content: `## Deploy preview\n\n:warning: Failed to generate deploy preview.`,
          };
        })
      : null,
  ]);

  const commentSections: Record<string, string> = {};

  if (bundleSizeReport) {
    commentSections.bundleSize = bundleSizeReport.content;
  }

  if (benchmarkReportResult) {
    commentSections.benchmark = benchmarkReportResult.content;
  }

  if (deployPreviewReport) {
    commentSections.deployPreview = deployPreviewReport.content;
  }

  await upsertPrComment(prRepo, pr.number, commentSections, {
    footer: `<hr>\n\nCheck out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${prRepo}/prs/${pr.number}) for more information about this PR.`,
  });

  return NextResponse.json({ success: true });
}

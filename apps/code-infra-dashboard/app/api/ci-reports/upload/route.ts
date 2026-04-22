import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { uploadReport } from '@/lib/ciReports/s3';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';

const VALID_REPORT_TYPES = new Set(['size-snapshot', 'benchmark']);

const uploadSchema = z.object({
  version: z.number(),
  timestamp: z.number(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  reportType: z.string(),
  prNumber: z.number().int().positive().optional(),
  branch: z.string(),
  report: z.any(),
  base: z.any().optional(),
});

const BASE_BRANCH_REGEX = /^(master|main|next|v[^/]*\.[^/]*)$/;

// This endpoint is authenticated via CI OIDC tokens. The client sends
// a Bearer token in the Authorization header, which is verified against
// the CI provider's JWKS to prove the request comes from a real CI job.
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

  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { commitSha, repo, reportType, branch, report } = parsed.data;

  // For benchmark uploads, store the full wrapper (version, timestamp, commitSha,
  // repo, branch, prNumber, reportType, report, base). Other report types keep
  // their historic "just the inner report" storage.
  const storedBody =
    reportType === 'benchmark' ? JSON.stringify(parsed.data) : JSON.stringify(report);

  if (!VALID_REPORT_TYPES.has(reportType)) {
    return NextResponse.json(
      {
        error: `Invalid reportType: ${reportType}. Must be one of: ${[...VALID_REPORT_TYPES].join(', ')}`,
      },
      { status: 400 },
    );
  }

  if (oidcResult.isTrusted) {
    // Same-org builds are fully trusted — use sourceRepo from OIDC for the S3 key.
    const key = `artifacts/${oidcResult.sourceRepo}/${commitSha}/${reportType}.json`;
    const isBaseBranch = BASE_BRANCH_REGEX.test(branch);
    await uploadReport({
      key,
      body: storedBody,
      isBaseBranch,
      branch,
    });
    return NextResponse.json({ key });
  }

  // Fork builds: verify the PR exists and the commit matches
  let pr;
  try {
    // Use repo from request body — the source repo (from OIDC) may be a
    // private fork that the GitHub App doesn't have access to.
    pr = await findAssociatedPr(oidcResult, { targetRepo: repo });
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
    return NextResponse.json(
      { error: 'Could not find an associated PR for this fork build' },
      { status: 403 },
    );
  }

  if (pr.state !== 'open') {
    return NextResponse.json({ error: `PR #${pr.number} is not open` }, { status: 403 });
  }

  if (pr.head.sha !== commitSha) {
    return NextResponse.json(
      {
        error: `Commit ${commitSha} does not match PR #${pr.number} head (${pr.head.sha})`,
      },
      { status: 403 },
    );
  }

  const targetRepo = pr.base.repo.full_name;

  if (!targetRepo.startsWith('mui/')) {
    return NextResponse.json(
      { error: `PR #${pr.number} targets ${targetRepo}, which is not in the mui org` },
      { status: 403 },
    );
  }

  const key = `artifacts/${targetRepo}/${commitSha}/${reportType}.json`;

  await uploadReport({
    key,
    body: storedBody,
    isBaseBranch: false,
    branch: pr.head.ref,
  });
  return NextResponse.json({ key });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { uploadReport } from '@/lib/ciReports/s3';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { verifyPr } from '@/lib/ciReports/verifyPr';

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

  const { commitSha, repo, reportType, prNumber, branch, report } = parsed.data;

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
      body: JSON.stringify(report),
      isBaseBranch,
      branch,
    });
    return NextResponse.json({ key });
  }

  if (!prNumber) {
    return NextResponse.json({ error: 'Fork builds must include a prNumber' }, { status: 400 });
  }

  let prResult;
  try {
    // Use repo from request body, not oidcResult.sourceRepo — the source repo
    // may be a private fork that the GitHub App doesn't have access to.
    prResult = await verifyPr(repo, prNumber, commitSha);
  } catch (error) {
    console.error(`PR verification failed for #${prNumber}:`, error);
    return NextResponse.json(
      {
        error: `Could not verify PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 403 },
    );
  }

  const key = `artifacts/${prResult.targetRepo}/${commitSha}/${reportType}.json`;

  await uploadReport({
    key,
    body: JSON.stringify(report),
    isBaseBranch: false,
    branch: prResult.pr.head.ref,
  });
  return NextResponse.json({ key });
}

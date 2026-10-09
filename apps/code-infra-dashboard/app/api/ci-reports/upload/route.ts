import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { uploadReport, writeMarker } from '@/lib/ciReports/s3';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import type { OidcVerificationResult } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';
import { repoSchema, reportTypeSchema } from '@/lib/ciReports/schemas';
import { isTrackedBranch, planUpload, uploadTimeSchema } from '@/lib/ciReports/timeline';

const uploadSchema = z.object({
  version: z.number(),
  timestamp: z.number(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  repo: repoSchema,
  reportType: reportTypeSchema,
  /** Ignored: the pull request is looked up from the verified build. Sent by older clients. */
  prNumber: z.number().int().positive().optional(),
  /** Ignored: the branch comes from the verified build. Sent by older clients. */
  branch: z.string().optional(),
  /** A timeline of the job's own, in place of the branch's; see `planUpload`. */
  timeline: z.string().optional(),
  /** When the commit was made, which orders it in its timeline: without it, it joins none. */
  commitTimestamp: uploadTimeSchema.optional(),
  report: z.any(),
  base: z.any().optional(),
});

interface UploadTarget {
  /** The repository the report is stored under. */
  repo: string;
  /** The branch a same-org build runs on, else `null`: a fork, or a ref that isn't a branch. */
  branch: string | null;
  /** The open pull request the build is for, else `null`. */
  prNumber: number | null;
}

/**
 * The open pull request a same-org build on an untracked branch is for. A failed lookup only costs
 * the report its pull request link, so it doesn't fail the upload.
 */
async function prNumberOf(oidcResult: OidcVerificationResult): Promise<number | null> {
  try {
    return (await findAssociatedPr(oidcResult))?.number ?? null;
  } catch (error) {
    console.error('PR lookup failed:', error);
    return null;
  }
}

/**
 * Where an upload is stored. Same-org builds are fully trusted; a fork build must be the head of an
 * open pull request into the organization, and is stored under the repository it targets.
 */
async function uploadTargetOf(
  oidcResult: OidcVerificationResult,
  { repo, commitSha }: { repo: string; commitSha: string },
): Promise<{ target: UploadTarget } | { error: string; status: number }> {
  if (oidcResult.isTrusted) {
    // The branch is the verified one, never the body's, so a build can't claim a tracked branch it
    // doesn't run on.
    const { branch } = oidcResult;
    return {
      target: {
        repo: oidcResult.sourceRepo,
        branch,
        prNumber: branch !== null && isTrackedBranch(branch) ? null : await prNumberOf(oidcResult),
      },
    };
  }

  let pr;
  try {
    // Use repo from request body — the source repo (from OIDC) may be a
    // private fork that the GitHub App doesn't have access to.
    pr = await findAssociatedPr(oidcResult, { targetRepo: repo });
  } catch (error) {
    console.error('PR lookup failed:', error);
    return {
      error: `Could not find associated PR: ${error instanceof Error ? error.message : String(error)}`,
      status: 403,
    };
  }

  if (!pr) {
    return { error: 'Could not find an associated PR for this fork build', status: 403 };
  }

  if (pr.state !== 'open') {
    return { error: `PR #${pr.number} is not open`, status: 403 };
  }

  if (pr.head.sha !== commitSha) {
    return {
      error: `Commit ${commitSha} does not match PR #${pr.number} head (${pr.head.sha})`,
      status: 403,
    };
  }

  const targetRepo = pr.base.repo.full_name;

  if (!targetRepo.startsWith('mui/')) {
    return {
      error: `PR #${pr.number} targets ${targetRepo}, which is not in the mui org`,
      status: 403,
    };
  }

  return { target: { repo: targetRepo, branch: null, prNumber: pr.number } };
}

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

  const { commitSha, repo, reportType, report, commitTimestamp, timeline } = parsed.data;

  if (!oidcResult.isTrusted && timeline !== undefined) {
    return NextResponse.json({ error: 'A fork build cannot name a timeline' }, { status: 400 });
  }

  const resolved = await uploadTargetOf(oidcResult, { repo, commitSha });
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { target } = resolved;

  const plan = planUpload({
    repo: target.repo,
    sha: commitSha,
    reportType,
    branch: target.branch,
    requested: timeline,
    commitTime: commitTimestamp,
  });
  if ('error' in plan) {
    return NextResponse.json({ error: plan.error }, { status: 400 });
  }

  // For benchmark uploads, store the full wrapper (version, timestamp, commitSha,
  // repo, branch, prNumber, reportType, report, base). Other report types keep
  // their historic "just the inner report" storage. The wrapper records the verified branch and
  // pull request, not the ones the client sent.
  const storedBody =
    reportType === 'benchmark'
      ? JSON.stringify({
          ...parsed.data,
          branch: target.branch ?? undefined,
          prNumber: target.prNumber ?? undefined,
        })
      : JSON.stringify(report);

  const tags = { isBaseBranch: plan.isBaseBranch, branch: target.branch };
  await uploadReport({ key: plan.reportKey, body: storedBody, ...tags });
  // Written after the report, so a timeline never lists a commit whose report isn't there.
  if (plan.pointerKey !== null) {
    await writeMarker({ key: plan.pointerKey, ...tags });
  }
  return NextResponse.json({ key: plan.reportKey, timeline: plan.timeline });
}

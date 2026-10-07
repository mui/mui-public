import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { uploadReport, writeMarker } from '@/lib/ciReports/s3';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import type { OidcVerificationResult } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';
import { repoSchema, reportTypeSchema } from '@/lib/ciReports/schemas';
import {
  isTrackedBranch,
  reportKey,
  resolveTimeline,
  timelinePointerKey,
} from '@/lib/ciReports/timeline';

const uploadSchema = z.object({
  version: z.number(),
  timestamp: z.number(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  repo: repoSchema,
  reportType: reportTypeSchema,
  prNumber: z.number().int().positive().optional(),
  branch: z.string(),
  /** A timeline of the job's own, in place of the branch's; see `resolveTimeline`. */
  timeline: z.string().optional(),
  /** When the commit was made, in milliseconds, to order it in its timeline. */
  commitTimestamp: z.number().optional(),
  report: z.any(),
  base: z.any().optional(),
});

interface UploadTarget {
  /** The repository the report is stored under. */
  repo: string;
  /** The branch the report is tagged with. */
  branch: string;
  /** The branch when it is tracked and the build is the repository's own, else `null`. */
  trackedBranch: string | null;
}

/**
 * Where an upload is stored. Same-org builds are fully trusted; a fork build must be the head of an
 * open pull request into the organization, and is stored under the repository it targets.
 */
async function uploadTargetOf(
  oidcResult: OidcVerificationResult,
  { repo, commitSha, branch }: { repo: string; commitSha: string; branch: string },
): Promise<UploadTarget | NextResponse> {
  if (oidcResult.isTrusted) {
    return {
      repo: oidcResult.sourceRepo,
      branch,
      trackedBranch: isTrackedBranch(branch) ? branch : null,
    };
  }

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

  return { repo: targetRepo, branch: pr.head.ref, trackedBranch: null };
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

  const { commitSha, repo, reportType, branch, report, timestamp, commitTimestamp } = parsed.data;

  const target = await uploadTargetOf(oidcResult, { repo, commitSha, branch });
  if (target instanceof NextResponse) {
    return target;
  }

  const resolution = resolveTimeline(parsed.data.timeline, target.trackedBranch);
  if ('error' in resolution) {
    return NextResponse.json({ error: resolution.error }, { status: 400 });
  }
  const { timeline } = resolution;

  // For benchmark uploads, store the full wrapper (version, timestamp, commitSha,
  // repo, branch, prNumber, reportType, report, base). Other report types keep
  // their historic "just the inner report" storage.
  const storedBody =
    reportType === 'benchmark' ? JSON.stringify(parsed.data) : JSON.stringify(report);

  const key = reportKey(target.repo, commitSha, reportType, timeline);
  await uploadReport({
    key,
    body: storedBody,
    isBaseBranch: target.trackedBranch !== null,
    branch: target.branch,
  });
  // Written after the report, so a timeline never lists a commit whose report isn't there.
  if (timeline !== null) {
    await writeMarker(
      timelinePointerKey(
        target.repo,
        timeline,
        reportType,
        commitTimestamp ?? timestamp,
        commitSha,
      ),
    );
  }
  return NextResponse.json({ key, timeline });
}

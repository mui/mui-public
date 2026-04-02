import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { findAssociatedPr } from '@/lib/ciReports/findAssociatedPr';
import { upsertPrComment } from '@/lib/ciReports/prComment';
import {
  generateBundleSizeReport,
  generatePendingBundleSizeReport,
} from '@/lib/ciReports/bundleSizeReport';
import { DASHBOARD_ORIGIN } from '@/constants';

const bundleSizeSectionSchema = z.object({
  status: z.enum(['pending', 'complete']),
  trackedBundles: z.array(z.string()).optional(),
});

const syncPrCommentSchema = z.object({
  repo: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format')
    .optional(),
  sections: z
    .object({
      bundleSize: bundleSizeSectionSchema.optional(),
    })
    .refine(
      (obj) => Object.values(obj).some((v) => v !== undefined),
      'At least one section is required',
    ),
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

  const { repo, sections } = parsed.data;

  if (!oidcResult.isTrusted && !repo) {
    return NextResponse.json({ error: 'Fork builds must include a repo field' }, { status: 400 });
  }

  let pr;
  try {
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
    // No PR found for this branch — not an error, just nothing to do
    return NextResponse.json({ success: true, skipped: true });
  }

  const targetRepo = pr.base.repo.full_name;
  const commitSha = pr.head.sha;

  const commentSections: Record<string, string> = {};

  if (sections.bundleSize) {
    if (sections.bundleSize.status === 'pending') {
      commentSections.bundleSize = generatePendingBundleSizeReport();
    } else {
      const report = await generateBundleSizeReport({
        repo: targetRepo,
        prNumber: pr.number,
        commitSha,
        pr,
        trackedBundles: sections.bundleSize.trackedBundles,
      });

      commentSections.bundleSize =
        report?.content ??
        `## Bundle size report\n\n:warning: No bundle size snapshot found for commit ${commitSha}.`;
    }
  }

  await upsertPrComment(targetRepo, pr.number, commentSections, {
    footer: `<hr>\n\nCheck out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${targetRepo}/prs/${pr.number}) for more information about this PR.`,
  });

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { verifyPr } from '@/lib/ciReports/verifyPr';
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
  prNumber: z.number().int().positive(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
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

  const { prNumber, commitSha, repo, sections } = parsed.data;

  if (!oidcResult.isTrusted && !repo) {
    return NextResponse.json({ error: 'Fork builds must include a repo field' }, { status: 400 });
  }

  let prResult;
  try {
    // For fork builds, use repo from request body — the source repo may be a
    // private fork that the GitHub App doesn't have access to.
    prResult = await verifyPr(
      oidcResult.isTrusted ? oidcResult.sourceRepo : repo!,
      prNumber,
      commitSha,
    );
  } catch (error) {
    console.error(`PR verification failed for #${prNumber}:`, error);
    return NextResponse.json(
      {
        error: `Could not verify PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 403 },
    );
  }

  const { pr, targetRepo } = prResult;

  const commentSections: Record<string, string> = {};

  if (sections.bundleSize) {
    if (sections.bundleSize.status === 'pending') {
      commentSections.bundleSize = generatePendingBundleSizeReport();
    } else {
      const report = await generateBundleSizeReport({
        repo: targetRepo,
        prNumber,
        commitSha,
        pr,
        trackedBundles: sections.bundleSize.trackedBundles,
      });

      commentSections.bundleSize =
        report?.content ??
        `## Bundle size report\n\n:warning: No bundle size snapshot found for commit ${commitSha}.`;
    }
  }

  await upsertPrComment(targetRepo, prNumber, commentSections, {
    footer: `<hr>\n\nCheck out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${targetRepo}/prs/${prNumber}) for more information about this PR.`,
  });

  return NextResponse.json({ success: true });
}

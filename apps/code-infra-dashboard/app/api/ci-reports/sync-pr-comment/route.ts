import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyOidcToken } from '@/lib/ciReports/oidcAuth';
import { verifyPr } from '@/lib/ciReports/verifyPr';
import { upsertPrComment } from '@/lib/ciReports/prComment';
import {
  generateBundleSizeReport,
  generatePendingBundleSizeReport,
} from '@/lib/ciReports/bundleSizeReport';

const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || 'https://frontend-public.mui.com';

const syncPrCommentSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  prNumber: z.number().int().positive(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'Must be a 40-character hex string'),
  trackedBundles: z.array(z.string()).optional(),
  buildUrl: z.string().url().optional(),
  status: z.enum(['pending', 'complete']),
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

  const commentOptions = {
    footer: `<hr>\n\nCheck out the [code infra dashboard](${DASHBOARD_ORIGIN}/repository/${repo}/prs/${prNumber}) for more information about this PR.`,
  };

  if (status === 'pending') {
    await upsertPrComment(
      repo,
      prNumber,
      { bundleSize: generatePendingBundleSizeReport(buildUrl) },
      commentOptions,
    );
    return NextResponse.json({ success: true });
  }

  const report = await generateBundleSizeReport({
    repo,
    prNumber,
    commitSha,
    pr,
    trackedBundles,
    buildUrl,
  });

  if (!report) {
    return NextResponse.json(
      { error: `No bundle size snapshot found for commit ${commitSha}` },
      { status: 422 },
    );
  }

  await upsertPrComment(repo, prNumber, { bundleSize: report.content }, commentOptions);

  return NextResponse.json({ success: true });
}

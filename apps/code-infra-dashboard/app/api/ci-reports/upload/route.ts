import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { uploadReport } from '@/lib/ciReports/s3';
import { verifyCircleCiToken } from '@/lib/ciReports/circleCiAuth';
import { getOctokit } from '@/lib/github';

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

// This endpoint is authenticated via CircleCI OIDC tokens. The client sends
// a Bearer token in the Authorization header, which is verified against
// CircleCI's JWKS to prove the request comes from a real CI job.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyCircleCiToken(authHeader.slice(7));
  } catch (error) {
    console.error('CircleCI OIDC token verification failed:', error);
    return NextResponse.json({ error: 'Invalid CircleCI OIDC token' }, { status: 401 });
  }

  // eslint-disable-next-line no-console
  console.log('CircleCI OIDC claims:', {
    'oidc.circleci.com/vcs-origin': claims['oidc.circleci.com/vcs-origin'],
    'oidc.circleci.com/vcs-ref': claims['oidc.circleci.com/vcs-ref'],
    'oidc.circleci.com/org-id': claims['oidc.circleci.com/org-id'],
  });

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

  const key = `artifacts/${repo}/${commitSha}/${reportType}.json`;
  const vcsOrigin = claims['oidc.circleci.com/vcs-origin'];
  const isSameOrg = vcsOrigin.startsWith('github.com/mui/');

  if (isSameOrg) {
    // Same-org builds are fully trusted — the OIDC token proves authenticity
    const isBaseBranch = BASE_BRANCH_REGEX.test(branch);
    await uploadReport({
      key,
      body: JSON.stringify(report),
      isBaseBranch,
      branch,
    });
    return NextResponse.json({ key });
  }

  // Fork builds: require prNumber and verify the SHA matches the PR head
  if (!prNumber) {
    return NextResponse.json({ error: 'Fork builds must include a prNumber' }, { status: 400 });
  }

  const [owner, repoName] = repo.split('/');
  const octokit = getOctokit();

  let pr;
  try {
    const response = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    pr = response.data;
  } catch (error) {
    console.error(`Failed to fetch PR #${prNumber} from ${repo}:`, error);
    return NextResponse.json(
      { error: `Could not verify PR #${prNumber} on ${repo}` },
      { status: 403 },
    );
  }

  if (pr.state !== 'open') {
    return NextResponse.json({ error: `PR #${prNumber} is not open` }, { status: 403 });
  }

  if (pr.head.sha !== commitSha) {
    return NextResponse.json(
      { error: `Commit ${commitSha} does not match PR #${prNumber} head (${pr.head.sha})` },
      { status: 403 },
    );
  }

  await uploadReport({
    key,
    body: JSON.stringify(report),
    isBaseBranch: false,
    branch: pr.head.ref,
  });
  return NextResponse.json({ key });
}

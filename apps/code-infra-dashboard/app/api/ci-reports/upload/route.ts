import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { sizeSnapshotUploadSchema } from '@mui/internal-bundle-size-checker/ciReport';
import { uploadReport } from '@/lib/ciReports/s3';

const ALLOWED_REPOS = new Set([
  'mui/material-ui',
  'mui/mui-x',
  'mui/base-ui',
  'mui/base-ui-charts',
  'mui/base-ui-mosaic',
  'mui/mui-public',
]);

const ALLOWED_BRANCHES = new Set(['master', 'main', 'next']);

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  return new Octokit({ auth: token });
}

// This endpoint is intentionally unauthenticated. It is called from CircleCI fork builds,
// which cannot access protected secrets, so any shared auth token would need to be exposed
// to untrusted code anyway. Instead, we validate uploaded data against the GitHub API
// (open PR state or commit reachability from an allowed branch) to limit what can be stored.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = sizeSnapshotUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { commitSha, repo, reportType, prNumber, branch, report } = parsed.data;

  if (!ALLOWED_REPOS.has(repo)) {
    return NextResponse.json({ error: `Repository "${repo}" is not allowed` }, { status: 403 });
  }

  const [owner, repoName] = repo.split('/');
  const key = `artifacts/${repo}/${commitSha}/${reportType}.json`;
  const octokit = getOctokit();

  if (prNumber) {
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

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
      isPullRequest: true,
      branch: pr.head.ref,
    });
    return NextResponse.json({ key });
  }

  if (!ALLOWED_BRANCHES.has(branch)) {
    return NextResponse.json(
      { error: `Branch "${branch}" is not in the allowlist` },
      { status: 403 },
    );
  }

  // Check that the commit is reachable from the branch head (not necessarily the head itself,
  // since multiple PRs can merge in rapid succession)
  const { data: comparison } = await octokit.repos.compareCommits({
    owner,
    repo: repoName,
    base: commitSha,
    head: branch,
  });

  if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
    return NextResponse.json(
      { error: `Commit ${commitSha} is not on branch "${branch}"` },
      { status: 403 },
    );
  }

  await uploadReport({ key, body: JSON.stringify(report), isPullRequest: false, branch });
  return NextResponse.json({ key });
}

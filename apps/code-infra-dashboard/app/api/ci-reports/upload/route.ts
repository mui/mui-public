import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { sizeSnapshotUploadSchema } from '@mui/internal-bundle-size-checker/ciReport';
import { uploadReport } from '@/lib/ciReports/s3';

interface ProjectConfig {
  repo: string;
  retainedBranches: string[];
}

const PROJECTS: ProjectConfig[] = [
  { repo: 'mui/material-ui', retainedBranches: ['master', 'next', 'v*.*'] },
  { repo: 'mui/mui-x', retainedBranches: ['master', 'next', 'v*.*'] },
  { repo: 'mui/base-ui', retainedBranches: ['main', 'v*.*'] },
  { repo: 'mui/base-ui-charts', retainedBranches: ['main', 'v*.*'] },
  { repo: 'mui/base-ui-mosaic', retainedBranches: ['main', 'v*.*'] },
  { repo: 'mui/mui-public', retainedBranches: ['master'] },
];

/**
 * Matches a string against a simple glob pattern (supports * as wildcard).
 */
function simpleGlobMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
  );
  return regex.test(value);
}

function isRetainedBranch(project: ProjectConfig, branch: string): boolean {
  return project.retainedBranches.some((pattern) => simpleGlobMatch(pattern, branch));
}

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

  const project = PROJECTS.find((p) => p.repo === repo);
  if (!project) {
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
      retained: false,
      branch: pr.head.ref,
    });
    return NextResponse.json({ key });
  }

  // CircleCI doesn't set PR-related env vars for same-repo (non-forked) PRs,
  // so the client may not know the PR number. Look it up by branch + commit SHA.
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo: repoName,
    head: `${owner}:${branch}`,
    state: 'open',
    per_page: 1,
  });

  const matchedPr = prs.find((pr) => pr.head.sha === commitSha);
  if (matchedPr) {
    await uploadReport({
      key,
      body: JSON.stringify(report),
      isPullRequest: true,
      retained: false,
      branch: matchedPr.head.ref,
    });
    return NextResponse.json({ key });
  }

  // For non-PR uploads, verify the commit is the current head of the branch
  const { data: branchData } = await octokit.repos.getBranch({
    owner,
    repo: repoName,
    branch,
  });

  if (branchData.commit.sha !== commitSha) {
    return NextResponse.json(
      { error: `Commit ${commitSha} is not the head of branch "${branch}"` },
      { status: 403 },
    );
  }

  const retained = isRetainedBranch(project, branch);
  await uploadReport({ key, body: JSON.stringify(report), isPullRequest: false, retained, branch });
  return NextResponse.json({ key });
}

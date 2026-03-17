import { Octokit } from '@octokit/rest';

const ALLOWED_REPOS = new Set([
  'mui/material-ui',
  'mui/mui-x',
  'mui/pigment-css',
  'mui/toolpad',
  'mui/base-ui',
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

export function isAllowedRepo(repo: string): boolean {
  return ALLOWED_REPOS.has(repo);
}

/**
 * Validates that a PR exists and the commit SHA matches the PR head.
 */
export async function validatePrCommit(
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
): Promise<{ valid: boolean; error?: string }> {
  const octokit = getOctokit();

  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  if (pr.state !== 'open') {
    return { valid: false, error: `PR #${prNumber} is not open` };
  }

  if (pr.head.sha !== commitSha) {
    return {
      valid: false,
      error: `Commit ${commitSha} does not match PR #${prNumber} head (${pr.head.sha})`,
    };
  }

  return { valid: true };
}

/**
 * Validates that a branch is in the allowlist and the commit exists on that branch.
 */
export async function validateBranchCommit(
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!ALLOWED_BRANCHES.has(branch)) {
    return { valid: false, error: `Branch "${branch}" is not in the allowlist` };
  }

  const octokit = getOctokit();

  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  if (ref.object.sha !== commitSha) {
    return {
      valid: false,
      error: `Commit ${commitSha} is not the head of branch "${branch}"`,
    };
  }

  return { valid: true };
}

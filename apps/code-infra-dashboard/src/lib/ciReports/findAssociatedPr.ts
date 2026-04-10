import { getOctokit } from '@/lib/github';
import type { OidcVerificationResult } from './oidcAuth';

export type AssociatedPr = Awaited<
  ReturnType<ReturnType<typeof getOctokit>['pulls']['get']>
>['data'];

export interface FindAssociatedPrOptions {
  /**
   * The upstream repo where the PR lives, in "owner/repo" format.
   * Required for fork builds since the OIDC sourceRepo is the private fork.
   * Defaults to `oidcResult.sourceRepo` for non-fork builds.
   */
  targetRepo?: string;
}

const FORK_PR_REF_REGEX = /^refs\/heads\/pull\/(\d+)$/;

/**
 * Finds the PR associated with a CI build based on OIDC claims.
 *
 * For non-fork (trusted) builds: extracts the branch name from the ref and
 * looks up an open PR for that branch.
 *
 * For fork builds: parses the PR number from the ref (which CircleCI sets to
 * "refs/heads/pull/<number>") and fetches the PR directly.
 *
 * Returns null if no associated PR is found. Does not validate PR state or
 * commit SHA — callers decide what checks to apply.
 */
export async function findAssociatedPr(
  oidcResult: OidcVerificationResult,
  options?: FindAssociatedPrOptions,
): Promise<AssociatedPr | null> {
  const octokit = getOctokit();
  const repo = options?.targetRepo ?? oidcResult.sourceRepo;
  const [owner, repoName] = repo.split('/');

  if (oidcResult.isTrusted) {
    // Non-fork: look up PR by branch name
    const branch = oidcResult.ref.replace(/^refs\/heads\//, '');

    const { data: prs } = await octokit.pulls.list({
      owner,
      repo: repoName,
      head: `${owner}:${branch}`,
      state: 'open',
      per_page: 1,
    });

    if (prs.length === 0) {
      return null;
    }

    return prs[0] as AssociatedPr;
  }

  // Fork: parse PR number from ref ("refs/heads/pull/<number>")
  const match = FORK_PR_REF_REGEX.exec(oidcResult.ref);
  if (!match) {
    return null;
  }

  const prNumber = Number(match[1]);
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  // Ensure the PR was opened from the same repo that the CI build is running on.
  // Without this check, a fork build could send a different `targetRepo` in the
  // request body and interact with PRs in repos it doesn't own.
  if (pr.head.repo?.full_name !== oidcResult.sourceRepo) {
    throw new Error(
      `PR #${prNumber} head repo (${pr.head.repo?.full_name}) does not match the CI source repo (${oidcResult.sourceRepo})`,
    );
  }

  return pr;
}

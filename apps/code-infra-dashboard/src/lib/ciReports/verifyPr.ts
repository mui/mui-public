import { getOctokit } from '@/lib/github';

export interface VerifyPrResult {
  pr: Awaited<ReturnType<ReturnType<typeof getOctokit>['pulls']['get']>>['data'];
  targetRepo: string;
  isFork: boolean;
}

/**
 * Fetches PR data from the given repo, verifying the PR is open and that
 * the commit SHA matches the PR head. Determines the target repo from the
 * PR's base branch and detects forks by comparing head and base repos.
 */
export async function verifyPr(
  repo: string,
  prNumber: number,
  commitSha: string,
): Promise<VerifyPrResult> {
  const octokit = getOctokit();

  const [owner, repoName] = repo.split('/');
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  if (pr.state !== 'open') {
    throw new Error(`PR #${prNumber} is not open`);
  }

  if (pr.head.sha !== commitSha) {
    throw new Error(`Commit ${commitSha} does not match PR #${prNumber} head (${pr.head.sha})`);
  }

  const targetRepo = pr.base.repo.full_name;

  if (!targetRepo.startsWith('mui/')) {
    throw new Error(`PR #${prNumber} targets ${targetRepo}, which is not in the mui org`);
  }

  const isFork = pr.head.repo?.full_name !== targetRepo;

  return { pr, targetRepo, isFork };
}

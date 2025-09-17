import { useQuery } from '@tanstack/react-query';
import { octokit, parseRepo } from '../utils/github';

export interface UseGitHubMergeBase {
  mergeBase: string | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch the merge base between a PR head and its base branch
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param baseRef The base branch reference
 * @param headSha The head SHA of the PR
 */
export function useGitHubMergeBase(
  repo: string,
  baseRef?: string,
  headSha?: string,
): UseGitHubMergeBase {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['github-merge-base', repo, baseRef, headSha],
    queryFn: async () => {
      if (!baseRef || !headSha) {
        return null;
      }
      const { owner, repo: repoName } = parseRepo(repo);
      const { data: compareInfo } = await octokit.rest.repos.compareCommits({
        owner,
        repo: repoName,
        base: baseRef,
        head: headSha,
      });
      return compareInfo.merge_base_commit?.sha || null;
    },
    retry: 1,
    enabled: Boolean(repo && baseRef && headSha),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    mergeBase: data,
    isLoading,
    error: error as Error | null,
  };
}

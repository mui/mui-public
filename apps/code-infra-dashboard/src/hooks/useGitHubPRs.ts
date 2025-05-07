import { useQuery } from '@tanstack/react-query';
import { GitHubPRInfo } from './useGitHubPR';

/**
 * Hook to fetch the latest PRs for a repository
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param limit Number of PRs to fetch (default: 10)
 */
export function useGitHubPRs(
  repo: string,
  limit: number = 10,
): { prs: GitHubPRInfo[]; isLoading: boolean; error: Error | null } {
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['github-prs', repo, limit],
    queryFn: async (): Promise<GitHubPRInfo[]> => {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${limit}`,
        );
        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const responseBody = await response.json();
        return responseBody;
      } catch (err) {
        console.error('Error fetching PRs:', err);
        throw err;
      }
    },
    retry: 1,
    enabled: Boolean(repo),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    prs: data,
    isLoading,
    error: error as Error | null,
  };
}
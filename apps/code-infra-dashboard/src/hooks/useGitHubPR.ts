import { useQuery } from '@tanstack/react-query';

export interface GitHubPRInfo {
  title: string;
  number: number;
  html_url: string;
}

/**
 * Hook to fetch PR information by PR number
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param prNumber The PR number to fetch information for
 */
export function useGitHubPR(
  repo: string,
  prNumber: number,
): { prInfo: GitHubPRInfo | null; isLoading: boolean; error: Error | null } {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['github-pr', repo, prNumber],
    queryFn: async (): Promise<GitHubPRInfo | null> => {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`);
        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const responseBody = await response.json();
        return {
          title: responseBody.title,
          number: prNumber,
          html_url: responseBody.html_url,
        };
      } catch (err) {
        console.error('Error fetching PR info:', err);
        throw err;
      }
    },
    enabled: Boolean(repo && prNumber),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    prInfo: data,
    isLoading,
    error: error as Error | null,
  };
}

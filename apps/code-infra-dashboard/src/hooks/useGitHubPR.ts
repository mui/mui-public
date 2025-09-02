import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../utils/http';

export interface GitHubPRInfo {
  title: string;
  number: number;
  html_url: string;
  base: {
    ref: string;
    sha: string;
    repo: {
      full_name: string;
    };
  };
  head: {
    ref: string;
    sha: string;
  };
}

export interface UseGitHubPR {
  prInfo: GitHubPRInfo | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch PR information by PR number
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param prNumber The PR number to fetch information for, optional
 */
export function useGitHubPR(repo: string, prNumber?: number): UseGitHubPR {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['github-pr', repo, prNumber],
    queryFn: async (): Promise<GitHubPRInfo> => {
      const responseBody = await fetchJson<GitHubPRInfo>(
        `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      );
      return responseBody;
    },
    retry: 1,
    enabled: Boolean(repo && prNumber),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    prInfo: data,
    isLoading,
    error: error as Error | null,
  };
}

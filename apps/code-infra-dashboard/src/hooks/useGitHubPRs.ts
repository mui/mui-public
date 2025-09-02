import { useInfiniteQuery } from '@tanstack/react-query';
import { GitHubPRInfo } from './useGitHubPR';
import { fetchJson } from '../utils/http';

export interface UseGitHubPRs {
  prs: GitHubPRInfo[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => void;
}

/**
 * Hook to fetch the latest PRs for a repository with pagination support
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param initialLimit Number of PRs to fetch initially (default: 5)
 */
export function useGitHubPRs(repo: string, initialLimit: number = 5): UseGitHubPRs {
  const { data, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['github-prs', repo],
      queryFn: async ({ pageParam = 1 }): Promise<GitHubPRInfo[]> => {
        // First page uses the initial limit, subsequent pages use 10
        const perPage = pageParam === 1 ? initialLimit : 10;
        return await fetchJson<GitHubPRInfo[]>(
          `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${pageParam}`,
        );
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage, allPages, lastPageParam) => {
        // GitHub returns an empty array when there are no more results
        if (lastPage.length === 0) {
          return undefined;
        }
        return lastPageParam + 1;
      },
      retry: 1,
      enabled: Boolean(repo),
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

  // Flatten all pages into a single array
  const prs = data?.pages.flat() ?? [];

  return {
    prs,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    error: error as Error | null,
    fetchNextPage,
  };
}

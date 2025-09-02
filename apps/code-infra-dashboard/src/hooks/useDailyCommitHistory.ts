import { useInfiniteQuery } from '@tanstack/react-query';
import * as React from 'react';
import { fetchSnapshot } from '@mui/internal-bundle-size-checker/browser';
import { RestEndpointMethodTypes } from '@octokit/rest';
import { octokit, parseRepo } from '../utils/github';

export type GitHubCommit =
  RestEndpointMethodTypes['repos']['listCommits']['response']['data'][number];

export interface DailyCommitData {
  date: string;
  commit: GitHubCommit;
  snapshot: Record<string, { parsed: number; gzip: number }> | null;
}

export interface UseDailyCommitHistory {
  dailyData: DailyCommitData[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => void;
}

interface PageParam {
  until?: string; // ISO date string to fetch commits before this date
}

interface PageData {
  dailyData: DailyCommitData[];
  nextCursor?: string; // Next date cursor for pagination
}

/**
 * Groups commits by day and returns the latest commit of each day
 */
function groupCommitsByDay(commits: GitHubCommit[]): Map<string, GitHubCommit> {
  const commitsByDay = new Map<string, GitHubCommit>();

  // Process commits in natural order (newest first from GitHub API)
  for (const commit of commits) {
    if (!commit.commit.author?.date) {
      continue;
    }
    const date = new Date(commit.commit.author.date).toISOString().split('T')[0];

    // Only keep the first commit we encounter for each day (latest commit of that day)
    if (!commitsByDay.has(date)) {
      commitsByDay.set(date, commit);
    }
  }

  return commitsByDay;
}

/**
 * Hook to fetch daily commits from master and their bundle size snapshots with infinite query support
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 */
export function useDailyCommitHistory(repo: string): UseDailyCommitHistory {
  const { data, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['daily-commit-history', repo],
      queryFn: async ({ pageParam }: { pageParam: PageParam }): Promise<PageData> => {
        const { owner, repo: repoName } = parseRepo(repo);

        // Fetch commits from master branch
        const commitParams: Parameters<typeof octokit.rest.repos.listCommits>[0] = {
          owner,
          repo: repoName,
          sha: 'master',

          per_page: 100,
        };

        // Add until parameter for pagination if we have a cursor
        if (pageParam?.until) {
          commitParams.until = pageParam.until;
        }

        const { data: commits } = await octokit.rest.repos.listCommits(commitParams);

        // Group by day and get first commit of each day
        const dailyCommits = groupCommitsByDay(commits);

        // Map entries are already in reverse chronological order (newest dates first)
        // due to GitHub API returning commits newest first and our reverse iteration
        const dailyCommitEntries = Array.from(dailyCommits.entries());

        // Take up to 30 days for this page
        const pageLimit = 30;
        const currentPageDays = dailyCommitEntries.slice(0, pageLimit);

        // Determine if we need to set up pagination cursor
        let nextCursor: string | undefined;
        if (commits.length > 0) {
          const oldestDateInPage = currentPageDays[currentPageDays.length - 1][0];
          const oldestDate = new Date(oldestDateInPage);
          // Subtract one day to ensure we don't miss commits from the same day
          oldestDate.setDate(oldestDate.getDate() - 1);
          nextCursor = oldestDate.toISOString();
        }

        // Fetch snapshots for each daily commit
        const dailyDataPromises = currentPageDays.map(
          async ([date, commit]): Promise<DailyCommitData> => {
            const snapshot = await fetchSnapshot(repo, commit.sha).catch(() => null);
            return { date, commit, snapshot };
          },
        );

        const dailyData = await Promise.all(dailyDataPromises);

        return {
          dailyData,
          nextCursor,
        };
      },
      initialPageParam: {} as PageParam,
      getNextPageParam: React.useCallback((lastPage: PageData) => {
        if (lastPage.nextCursor) {
          return { until: lastPage.nextCursor };
        }
        return undefined; // No more pages
      }, []),
      retry: 1,
      enabled: Boolean(repo),
      staleTime: 5 * 60 * 1000, // Cache commits for 5 minutes
    });

  // Flatten all pages into a single array with memoization to prevent re-renders
  const allDailyData = React.useMemo(() => {
    return data?.pages.flatMap((page) => page.dailyData).reverse() ?? [];
  }, [data?.pages]);

  return {
    dailyData: allDailyData,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    error: error as Error | null,
    fetchNextPage,
  };
}

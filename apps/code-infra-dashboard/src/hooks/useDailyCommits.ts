import { useInfiniteQuery } from '@tanstack/react-query';
import * as React from 'react';
import { RestEndpointMethodTypes } from '@octokit/rest';
import { octokit, parseRepo } from '../utils/github';

export type GitHubCommit =
  RestEndpointMethodTypes['repos']['listCommits']['response']['data'][number];

export interface DailyCommit {
  date: string;
  commit: GitHubCommit;
}

export interface UseDailyCommits {
  dailyCommits: DailyCommit[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => void;
}

interface PageParam {
  until?: string;
}

interface PageData {
  dailyCommits: DailyCommit[];
  nextCursor?: string;
}

/**
 * Groups commits by day and returns the latest commit of each day
 */
function groupCommitsByDay(commits: GitHubCommit[]): Map<string, GitHubCommit> {
  const commitsByDay = new Map<string, GitHubCommit>();

  for (const commit of commits) {
    if (!commit.commit.author?.date) {
      continue;
    }
    const date = new Date(commit.commit.author.date).toISOString().split('T')[0];

    if (!commitsByDay.has(date)) {
      commitsByDay.set(date, commit);
    }
  }

  return commitsByDay;
}

/**
 * Hook to fetch daily commits from master with infinite query support.
 * Returns the latest commit per day, paginated.
 * @param repo Full repository name in the format "org/repo"
 */
export function useDailyCommits(repo: string): UseDailyCommits {
  const { data, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['daily-commits', repo],
      queryFn: async ({ pageParam }: { pageParam: PageParam }): Promise<PageData> => {
        const { owner, repo: repoName } = parseRepo(repo);

        const commitParams: Parameters<typeof octokit.rest.repos.listCommits>[0] = {
          owner,
          repo: repoName,
          sha: 'master',
          per_page: 100,
        };

        if (pageParam?.until) {
          commitParams.until = pageParam.until;
        }

        const { data: commits } = await octokit.rest.repos.listCommits(commitParams);

        const dailyCommitMap = groupCommitsByDay(commits);
        const dailyCommitEntries = Array.from(dailyCommitMap.entries());

        const pageLimit = 30;
        const currentPageDays = dailyCommitEntries.slice(0, pageLimit);

        let nextCursor: string | undefined;
        if (commits.length > 0) {
          const oldestDateInPage = currentPageDays[currentPageDays.length - 1][0];
          const oldestDate = new Date(oldestDateInPage);
          oldestDate.setDate(oldestDate.getDate() - 1);
          nextCursor = oldestDate.toISOString();
        }

        return {
          dailyCommits: currentPageDays.map(([date, commit]) => ({ date, commit })),
          nextCursor,
        };
      },
      initialPageParam: {} as PageParam,
      getNextPageParam: React.useCallback((lastPage: PageData) => {
        if (lastPage.nextCursor) {
          return { until: lastPage.nextCursor };
        }
        return undefined;
      }, []),
      retry: 1,
      enabled: Boolean(repo),
      staleTime: 5 * 60 * 1000,
    });

  const allDailyCommits = React.useMemo(() => {
    return data?.pages.flatMap((page) => page.dailyCommits).reverse() ?? [];
  }, [data?.pages]);

  return {
    dailyCommits: allDailyCommits,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    error: error as Error | null,
    fetchNextPage,
  };
}

import { useInfiniteQuery } from '@tanstack/react-query';
import * as React from 'react';
import { RestEndpointMethodTypes } from '@octokit/rest';
import { octokit, parseRepo } from '../utils/github';

export type GitHubCommit =
  RestEndpointMethodTypes['repos']['listCommits']['response']['data'][number];

export interface DailyReportData<TReport> {
  date: string;
  commit: GitHubCommit;
  report: TReport | null;
}

export interface UseDailyReportHistory<TReport> {
  dailyData: DailyReportData<TReport>[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => void;
}

interface PageParam {
  until?: string;
}

interface PageData<TReport> {
  dailyData: DailyReportData<TReport>[];
  nextCursor?: string;
}

/**
 * Groups commits by day and returns the latest commit of each day
 */
export function groupCommitsByDay(commits: GitHubCommit[]): Map<string, GitHubCommit> {
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
 * Generic hook to fetch daily commits from master and their reports with infinite query support.
 * @param repo Full repository name in the format "org/repo"
 * @param queryKey Unique query key prefix for React Query caching
 * @param fetchReport Function that fetches a report for a given repo and SHA
 */
export function useDailyReportHistory<TReport>(
  repo: string,
  queryKey: string,
  fetchReport: (repo: string, sha: string) => Promise<TReport>,
): UseDailyReportHistory<TReport> {
  const { data, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useInfiniteQuery({
      queryKey: [queryKey, repo],
      queryFn: async ({ pageParam }: { pageParam: PageParam }): Promise<PageData<TReport>> => {
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

        const dailyCommits = groupCommitsByDay(commits);
        const dailyCommitEntries = Array.from(dailyCommits.entries());

        const pageLimit = 30;
        const currentPageDays = dailyCommitEntries.slice(0, pageLimit);

        let nextCursor: string | undefined;
        if (commits.length > 0) {
          const oldestDateInPage = currentPageDays[currentPageDays.length - 1][0];
          const oldestDate = new Date(oldestDateInPage);
          oldestDate.setDate(oldestDate.getDate() - 1);
          nextCursor = oldestDate.toISOString();
        }

        const dailyDataPromises = currentPageDays.map(
          async ([date, commit]): Promise<DailyReportData<TReport>> => {
            const report = await fetchReport(repo, commit.sha).catch(() => null);
            return { date, commit, report };
          },
        );

        const dailyData = await Promise.all(dailyDataPromises);

        return {
          dailyData,
          nextCursor,
        };
      },
      initialPageParam: {} as PageParam,
      getNextPageParam: React.useCallback((lastPage: PageData<TReport>) => {
        if (lastPage.nextCursor) {
          return { until: lastPage.nextCursor };
        }
        return undefined;
      }, []),
      retry: 1,
      enabled: Boolean(repo),
      staleTime: 5 * 60 * 1000,
    });

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

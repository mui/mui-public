import { useInfiniteQuery } from '@tanstack/react-query';
import * as React from 'react';
import { type RestEndpointMethodTypes } from '@octokit/rest';
import { octokit, parseRepo } from '../utils/github';

export type GitHubCommit =
  RestEndpointMethodTypes['repos']['listCommits']['response']['data'][number];

export interface Commit {
  timestamp: number;
  commit: GitHubCommit;
}

export interface UseMasterCommits {
  commits: Commit[];
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
  commits: Commit[];
  nextCursor?: string;
}

const PAGE_LIMIT = 30;

function toCommit(commit: GitHubCommit): Commit | null {
  const isoDate = commit.commit.author?.date;
  if (!isoDate) {
    return null;
  }
  return { timestamp: new Date(isoDate).getTime(), commit };
}

function groupCommitsByDay(commits: GitHubCommit[]): Commit[] {
  const commitsByDay = new Map<string, Commit>();
  for (const commit of commits) {
    const entry = toCommit(commit);
    if (!entry) {
      continue;
    }
    const dayKey = new Date(entry.timestamp).toISOString().split('T')[0];
    if (!commitsByDay.has(dayKey)) {
      commitsByDay.set(dayKey, entry);
    }
  }
  return Array.from(commitsByDay.values());
}

export interface UseMasterCommitsOptions {
  groupByDay?: boolean;
}

/**
 * Hook to fetch commits from master with infinite query support.
 * With `groupByDay: true`, returns the first commit of each day.
 * Otherwise, returns every commit up to the page limit.
 */
export function useMasterCommits(
  repo: string,
  { groupByDay = false }: UseMasterCommitsOptions = {},
): UseMasterCommits {
  const { data, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['master-commits', repo, groupByDay ? 'daily' : 'per-commit'],
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

        const { data: rawCommits } = await octokit.rest.repos.listCommits(commitParams);

        if (groupByDay) {
          const daily = groupCommitsByDay(rawCommits).slice(0, PAGE_LIMIT);
          let nextCursor: string | undefined;
          if (daily.length > 0) {
            const oldest = new Date(daily[daily.length - 1].timestamp);
            oldest.setDate(oldest.getDate() - 1);
            nextCursor = oldest.toISOString();
          }
          return { commits: daily, nextCursor };
        }

        const perCommit: Commit[] = [];
        for (const raw of rawCommits) {
          const entry = toCommit(raw);
          if (entry) {
            perCommit.push(entry);
          }
          if (perCommit.length >= PAGE_LIMIT) {
            break;
          }
        }
        let nextCursor: string | undefined;
        if (perCommit.length > 0) {
          nextCursor = new Date(perCommit[perCommit.length - 1].timestamp - 1000).toISOString();
        }
        return { commits: perCommit, nextCursor };
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

  const allCommits = React.useMemo(() => {
    return data?.pages.flatMap((page) => page.commits).reverse() ?? [];
  }, [data?.pages]);

  return {
    commits: allCommits,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    error: error as Error | null,
    fetchNextPage,
  };
}

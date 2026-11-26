'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  InfiniteData,
  QueryFunctionContext,
  QueryKey,
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type { Octokit } from '@octokit/rest';
import { anonymousOctokit, proxiedOctokit } from '../utils/github';
import { useSession } from './useSession';

/**
 * Every GitHub query goes through here, so none can forget the rules below.
 *
 * - The key is scoped to the visitor, so results never cross a sign-in or sign-out.
 * - Queries wait until the session is known: until then a signed-in visitor would
 *   query GitHub anonymously first, spending the 60/hour budget that signing in
 *   exists to avoid. They report that wait as loading, so views show their
 *   loading state rather than an empty one.
 * - A failure is retried once, unless GitHub refused the request (a 4xx other than
 *   429): asking again gets the same answer, and a 401 only reaches the query
 *   client's sign-out handling after the retry.
 */
function retryOnce(failureCount: number, error: Error): boolean {
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const refused = status !== undefined && status >= 400 && status < 500 && status !== 429;
  return !refused && failureCount < 1;
}

function useGitHubClient() {
  const { session, isPending } = useSession();
  const login = session?.signedIn ? session.login : undefined;
  return {
    octokit: login ? proxiedOctokit : anonymousOctokit,
    ready: !isPending,
    scope: (queryKey: readonly unknown[]): QueryKey => [
      'github',
      login ?? 'anonymous',
      ...queryKey,
    ],
  };
}

export interface GitHubQueryResult<TData> {
  data: TData | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
}

type GitHubQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData, QueryKey>,
  'queryKey' | 'queryFn' | 'enabled' | 'retry'
> & {
  queryKey: readonly unknown[];
  queryFn: (octokit: Octokit) => Promise<TData>;
  enabled?: boolean;
};

export function useGitHubQuery<TData>({
  queryKey,
  queryFn,
  enabled = true,
  ...options
}: GitHubQueryOptions<TData>): GitHubQueryResult<TData> {
  const { octokit, ready, scope } = useGitHubClient();
  const result = useQuery({
    ...options,
    queryKey: scope(queryKey),
    queryFn: () => queryFn(octokit),
    enabled: ready && enabled,
    retry: retryOnce,
  });

  return {
    data: result.data,
    error: result.error,
    isError: result.isError,
    isLoading: result.isLoading || (!ready && enabled),
  };
}

export interface GitHubInfiniteQueryResult<TPage, TPageParam> extends GitHubQueryResult<
  InfiniteData<TPage, TPageParam>
> {
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
}

type GitHubInfiniteQueryOptions<TPage, TPageParam> = Omit<
  UseInfiniteQueryOptions<TPage, Error, InfiniteData<TPage, TPageParam>, QueryKey, TPageParam>,
  'queryKey' | 'queryFn' | 'enabled' | 'retry'
> & {
  queryKey: readonly unknown[];
  /** Gets the whole context: its `pageParam` only resolves where the page type is concrete. */
  queryFn: (
    octokit: Octokit,
    context: QueryFunctionContext<QueryKey, TPageParam>,
  ) => Promise<TPage>;
  enabled?: boolean;
};

export function useGitHubInfiniteQuery<TPage, TPageParam>({
  queryKey,
  queryFn,
  enabled = true,
  ...options
}: GitHubInfiniteQueryOptions<TPage, TPageParam>): GitHubInfiniteQueryResult<TPage, TPageParam> {
  const { octokit, ready, scope } = useGitHubClient();
  const result = useInfiniteQuery({
    ...options,
    queryKey: scope(queryKey),
    queryFn: (context: QueryFunctionContext<QueryKey, TPageParam>) => queryFn(octokit, context),
    enabled: ready && enabled,
    retry: retryOnce,
  });

  return {
    data: result.data,
    error: result.error,
    isError: result.isError,
    isLoading: result.isLoading || (!ready && enabled),
    isFetchingNextPage: result.isFetchingNextPage,
    hasNextPage: result.hasNextPage,
    fetchNextPage: result.fetchNextPage,
  };
}

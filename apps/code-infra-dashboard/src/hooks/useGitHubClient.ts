'use client';

import type { Octokit } from '@octokit/rest';
import { anonymousOctokit, proxiedOctokit } from '../utils/github';
import { useSession } from './useSession';

export interface UseGitHubClient {
  /** Proxied through our server when signed in, straight to GitHub when not. */
  octokit: Octokit;
  /**
   * False until the session is known. Until then a signed-in visitor would query
   * GitHub anonymously first, spending the 60/hour budget that signing in exists
   * to avoid and 404-ing on private repositories.
   */
  ready: boolean;
  /** Builds a query key scoped to the visitor, so results never cross identities. */
  key: (...parts: unknown[]) => unknown[];
}

export function useGitHubClient(): UseGitHubClient {
  const { session, isPending } = useSession();
  const login = session?.signedIn ? session.login : undefined;

  return {
    octokit: login ? proxiedOctokit : anonymousOctokit,
    ready: !isPending,
    key: (...parts) => ['github', login ?? 'anonymous', ...parts],
  };
}

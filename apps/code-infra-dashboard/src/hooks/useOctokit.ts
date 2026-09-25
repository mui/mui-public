'use client';

import * as React from 'react';
import type { Octokit } from '@octokit/rest';
import { useSession } from '../components/auth/SessionProvider';
import { anonymousOctokit, getProxiedOctokit } from '../utils/github';

/**
 * The GitHub client for the current visitor: proxied through our server when
 * signed in, straight to GitHub when not.
 *
 * Pair every query that uses this with the `identity` from `useSession` in its
 * query key, so cached results don't leak across a sign-in or sign-out.
 */
export function useOctokit(): Octokit {
  const { session } = useSession();
  const signedIn = Boolean(session?.signedIn);

  return React.useMemo(
    () => (signedIn ? getProxiedOctokit() : anonymousOctokit),
    // getProxiedOctokit touches window, so it must not run during SSR.
    [signedIn],
  );
}

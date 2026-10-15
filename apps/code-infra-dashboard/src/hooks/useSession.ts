'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../utils/http';

export interface SessionResponse {
  /** Whether this deployment has GitHub sign-in configured at all. */
  available: boolean;
  signedIn: boolean;
  login?: string;
  name?: string | null;
  avatarUrl?: string;
}

export interface UseSession {
  /** Null while loading, and when the session can't be read: treat as signed out. */
  session: SessionResponse | null;
  isPending: boolean;
}

/**
 * Shared with code outside React that needs to re-read the session into the same
 * cache entry the components watch. Reading it also refreshes an expired GitHub
 * token, server-side.
 */
export const sessionQueryOptions = queryOptions({
  queryKey: ['auth-session'],
  queryFn: () => fetchSession(false),
});

/**
 * The same cache entry, read after GitHub rejected the token: also asks GitHub
 * whether the current token still works.
 */
export const verifiedSessionQueryOptions = queryOptions({
  ...sessionQueryOptions,
  queryFn: () => fetchSession(true),
});

function fetchSession(verify: boolean): Promise<SessionResponse> {
  const url = new URL('/api/auth/session', window.location.origin);
  if (verify) {
    url.searchParams.set('verify', '1');
  }
  return fetchJson<SessionResponse>(url.href);
}

export function useSession(): UseSession {
  const { data, isPending } = useQuery({
    ...sessionQueryOptions,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return { session: data ?? null, isPending };
}

export function signIn(): void {
  const loginUrl = new URL('/api/auth/login', window.location.origin);
  loginUrl.searchParams.set('returnTo', `${window.location.pathname}${window.location.search}`);
  window.location.href = loginUrl.toString();
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  // Sign-in is a full navigation too; reloading drops every response that was
  // fetched as the signed-in user along with the rest of the tab's cache.
  window.location.reload();
}

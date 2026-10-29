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

/** Shared with the query client, which invalidates it when GitHub rejects the session. */
export const sessionQueryOptions = queryOptions({
  queryKey: ['auth-session'],
  queryFn: () => fetchJson<SessionResponse>('/api/auth/session'),
});

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

/** Rejects when the server didn't sign the user out, rather than pretending it did. */
export async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Signing out failed with ${response.status}.`);
  }
  // Sign-in is a full navigation too; reloading drops every response that was
  // fetched as the signed-in user along with the rest of the tab's cache.
  window.location.reload();
}

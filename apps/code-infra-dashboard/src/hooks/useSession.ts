'use client';

import { useQuery } from '@tanstack/react-query';
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

export function useSession(): UseSession {
  const { data, isPending } = useQuery({
    queryKey: ['auth-session'],
    queryFn: () => fetchJson<SessionResponse>('/api/auth/session'),
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

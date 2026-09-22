'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface DashboardSession {
  /** Whether this deployment has GitHub sign-in configured at all. */
  available: boolean;
  signedIn: boolean;
  login?: string;
  name?: string | null;
  avatarUrl?: string;
}

export interface SessionContextValue {
  session: DashboardSession | null;
  isLoading: boolean;
  /**
   * Identity to mix into react-query keys. Without it a cached anonymous 404 on
   * a private repo would survive signing in, and private data would survive
   * signing out.
   */
  identity: string;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = React.useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used within a SessionProvider.');
  }
  return value;
}

export const SESSION_QUERY_KEY = ['auth-session'];

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data = null, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<DashboardSession> => {
      const response = await fetch('/api/auth/session');
      if (!response.ok) {
        throw new Error(`Failed to read session: ${response.status}`);
      }
      return response.json();
    },
    // This query is also the only place a GitHub token gets refreshed, so it
    // must stay a single in-flight request rather than fanning out.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const signIn = React.useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const signOut = React.useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    // clear(), not invalidateQueries(): the latter would immediately refetch
    // every GitHub query anonymously instead of just dropping the data.
    queryClient.clear();
    await queryClient.refetchQueries({ queryKey: SESSION_QUERY_KEY });
  }, [queryClient]);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      session: data,
      isLoading,
      identity: data?.login ?? 'anon',
      signIn,
      signOut,
    }),
    [data, isLoading, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

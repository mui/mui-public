import { QueryCache, QueryClient, hashKey } from '@tanstack/react-query';
import { sessionQueryOptions } from '../hooks/useSession';

/**
 * The app's query cache. Every proxied GitHub request runs inside a query, and
 * the proxy answers 401 once the session is over -- its token expired with the
 * cookie, or the user revoked the app -- so a rejected query re-reads the session
 * and the components switch to anonymous requests.
 */
export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof Error && 'status' in error && error.status === 401) {
        // Restarts any read already in flight: it may have left before the proxy
        // cleared the cookie, and would report the session as still signed in.
        queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
      }
    },
  }),
});

/**
 * Tabs share the session cookie but each keeps its own copy of the session, so a
 * tab whose session read finds someone else signed in (or no one) tells the
 * others, which read theirs again. Without it, a tab left open after signing out
 * elsewhere keeps its signed-in view, private data included, until its copy goes
 * stale. A tab's first read always announces itself: it may be the page a sign-in
 * just landed on.
 */
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  const sessionChannel = new BroadcastChannel('dashboard-session');
  const sessionHash = hashKey(sessionQueryOptions.queryKey);
  let announcedLogin: string | null | undefined;

  sessionChannel.addEventListener('message', () => {
    queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
  });

  queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'success' ||
      event.query.queryHash !== sessionHash
    ) {
      return;
    }
    const session = queryClient.getQueryData(sessionQueryOptions.queryKey);
    const login = session?.signedIn ? (session.login ?? null) : null;
    if (login !== announcedLogin) {
      announcedLogin = login;
      sessionChannel.postMessage(null);
    }
  });
}

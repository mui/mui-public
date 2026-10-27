import { QueryCache, QueryClient } from '@tanstack/react-query';
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
        // Not cancelling an in-flight read lets queries rejected together share it.
        queryClient.invalidateQueries(
          { queryKey: sessionQueryOptions.queryKey },
          { cancelRefetch: false },
        );
      }
    },
  }),
});

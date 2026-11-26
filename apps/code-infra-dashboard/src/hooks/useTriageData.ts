import { useQuery } from '@tanstack/react-query';
import type { TriageRow, TriageView } from '../lib/triage/types';
import { fetchTriageData } from '../lib/triage/actions';
import { useSession } from './useSession';

export function useTriageData(viewId: TriageView) {
  // Signed-in readers also get the private repositories GitHub lets them read, so
  // the rows are scoped to the visitor and never outlive a sign-in or sign-out.
  const { session, isPending } = useSession();
  const login = session?.signedIn ? session.login : undefined;
  const { data, isLoading, error } = useQuery<TriageRow[]>({
    queryKey: ['triage', login ?? 'anonymous', viewId],
    queryFn: () => fetchTriageData(viewId),
    enabled: !isPending,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });

  return {
    rows: data ?? [],
    isLoading: isLoading || isPending,
    error: error as Error | null,
  };
}

import { useQuery } from '@tanstack/react-query';
import type { TriageRow, TriageView } from '../lib/triage/types';
import { fetchTriageData } from '../lib/triage/actions';
import { useVisitorScope } from './useSession';

export function useTriageData(viewId: TriageView) {
  // Signed-in readers also get the private repositories GitHub lets them read.
  const { ready, scope } = useVisitorScope();
  const { data, isLoading, error } = useQuery<TriageRow[]>({
    queryKey: scope(['triage', viewId]),
    queryFn: () => fetchTriageData(viewId),
    enabled: ready,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });

  return {
    rows: data ?? [],
    isLoading: isLoading || !ready,
    error: error as Error | null,
  };
}

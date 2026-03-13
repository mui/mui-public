import { useQuery } from '@tanstack/react-query';
import type { TriageRow, TriageView } from '../lib/triage/types';
import { fetchTriageData } from '../lib/triage/actions';

export function useTriageData(viewId: TriageView) {
  const { data, isLoading, error } = useQuery<TriageRow[]>({
    queryKey: ['triage', viewId],
    queryFn: () => fetchTriageData(viewId),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  return {
    rows: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}

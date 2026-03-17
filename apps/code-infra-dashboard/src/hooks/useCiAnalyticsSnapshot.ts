import { useQuery } from '@tanstack/react-query';
import { fetchCiSnapshot, fetchSnapshotIndex } from '../lib/ciAnalytics';
import type { CiSnapshot } from '../lib/ciAnalytics';

export function useCiAnalyticsSnapshot(source: string | undefined) {
  return useQuery<CiSnapshot>({
    queryKey: ['ci-analytics-snapshot', source],
    queryFn: () => fetchCiSnapshot(source!),
    enabled: !!source,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCiSnapshotIndex() {
  return useQuery<string[]>({
    queryKey: ['ci-analytics-index'],
    queryFn: fetchSnapshotIndex,
    staleTime: 10 * 60 * 1000,
  });
}

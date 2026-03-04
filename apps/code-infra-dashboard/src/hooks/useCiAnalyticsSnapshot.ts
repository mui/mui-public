import { useQuery } from '@tanstack/react-query';
import { fetchCiSnapshot, fetchSnapshotIndex } from '../lib/ciAnalytics';
import type { CiSnapshot } from '../lib/ciAnalytics';

export function useCiAnalyticsSnapshot(timestamp?: string) {
  return useQuery<CiSnapshot>({
    queryKey: ['ci-analytics-snapshot', timestamp ?? 'latest'],
    queryFn: () => fetchCiSnapshot(timestamp),
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

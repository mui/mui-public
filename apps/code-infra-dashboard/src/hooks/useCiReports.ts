import { useQueries } from '@tanstack/react-query';
import { fetchCiReport, type CiReportName, type CiReportTypes } from '@/utils/fetchCiReport';
import type { Commit } from './useMasterCommits';

/**
 * Hook to fetch CI reports for a list of commits.
 * Uses `useQueries` so each report is cached independently by SHA.
 */
export function useCiReports<K extends CiReportName>(
  repo: string,
  commits: Commit[],
  reportName: K,
) {
  return useQueries({
    queries: commits.map((c) => ({
      queryKey: [reportName, repo, c.commit.sha],
      queryFn: () => fetchCiReport(repo, c.commit.sha, reportName),
      retry: 1,
      staleTime: 5 * 60 * 1000,
    })),
    combine: (results) => {
      const reports: Record<string, CiReportTypes[K]> = {};
      commits.forEach((commit, i) => {
        const result = results[i];
        if (result.data != null) {
          reports[commit.commit.sha] = result.data;
        }
      });
      return {
        reports,
        isLoading: results.some((r) => r.isLoading),
      };
    },
  });
}

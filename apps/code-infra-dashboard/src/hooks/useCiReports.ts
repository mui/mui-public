import { useQueries } from '@tanstack/react-query';
import { DailyCommit } from './useDailyCommits';

export interface UseCiReports<TReport> {
  reports: Record<string, TReport>; // sha → report (only successful fetches)
  isLoading: boolean; // true while any report is still loading
}

/**
 * Hook to fetch CI reports for a list of daily commits.
 * Uses `useQueries` so each report is cached independently by SHA.
 * @param repo Full repository name in the format "org/repo"
 * @param commits List of daily commits to fetch reports for
 * @param reportId Unique identifier for this report type (used as query key prefix)
 * @param fetchReport Function that fetches a report for a given repo and SHA
 */
export function useCiReports<TReport>(
  repo: string,
  commits: DailyCommit[],
  reportId: string,
  fetchReport: (repo: string, sha: string) => Promise<TReport>,
): UseCiReports<TReport> {
  return useQueries({
    queries: commits.map((c) => ({
      queryKey: [reportId, repo, c.commit.sha],
      queryFn: () => fetchReport(repo, c.commit.sha),
      retry: 1,
      staleTime: 5 * 60 * 1000,
    })),
    combine: (results) => {
      const reports: Record<string, TReport> = {};
      commits.forEach((commit, i) => {
        const result = results[i];
        if (result.data !== undefined) {
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

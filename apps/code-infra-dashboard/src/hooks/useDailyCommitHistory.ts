import { fetchSnapshot } from '@mui/internal-bundle-size-checker/browser';
import {
  useDailyReportHistory,
  type GitHubCommit,
  type DailyReportData,
  type UseDailyReportHistory,
} from './useDailyReportHistory';

type SizeSnapshot = Record<string, { parsed: number; gzip: number }>;

export type { GitHubCommit };

export type DailyCommitData = DailyReportData<SizeSnapshot> & {
  /** Alias for `report` — kept for backward compatibility with DailyBundleSizeChart */
  snapshot: SizeSnapshot | null;
};

export type UseDailyCommitHistory = Omit<UseDailyReportHistory<SizeSnapshot>, 'dailyData'> & {
  dailyData: DailyCommitData[];
};

/**
 * Hook to fetch daily commits from master and their bundle size snapshots with infinite query support
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 */
export function useDailyCommitHistory(repo: string): UseDailyCommitHistory {
  const result = useDailyReportHistory<SizeSnapshot>(repo, 'daily-commit-history', fetchSnapshot);

  return {
    ...result,
    dailyData: result.dailyData.map((entry) => ({
      ...entry,
      snapshot: entry.report,
    })),
  };
}

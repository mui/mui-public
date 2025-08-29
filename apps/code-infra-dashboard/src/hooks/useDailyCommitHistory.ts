import { useQuery } from '@tanstack/react-query';
import { fetchSnapshot } from '@mui/internal-bundle-size-checker/browser';

export interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      date: string;
    };
    message: string;
  };
}

export interface DailyCommitData {
  date: string;
  commit: GitHubCommit;
  snapshot: Record<string, { parsed: number; gzip: number }> | null;
}

export interface UseDailyCommitHistory {
  dailyData: DailyCommitData[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Groups commits by day and returns the first commit of each day
 */
function groupCommitsByDay(commits: GitHubCommit[]): Map<string, GitHubCommit> {
  const commitsByDay = new Map<string, GitHubCommit>();

  for (const commit of commits) {
    const date = new Date(commit.commit.author.date).toISOString().split('T')[0];

    // Only keep the first commit of each day (commits are ordered newest first)
    if (!commitsByDay.has(date)) {
      commitsByDay.set(date, commit);
    }
  }

  return commitsByDay;
}

/**
 * Hook to fetch daily commits from master and their bundle size snapshots
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 */
export function useDailyCommitHistory(repo: string): UseDailyCommitHistory {
  const { data, isLoading, error } = useQuery({
    queryKey: ['daily-commit-history', repo],
    queryFn: async (): Promise<DailyCommitData[]> => {
      try {
        // Fetch commits from master branch
        const commitsResponse = await fetch(
          `https://api.github.com/repos/${repo}/commits?sha=master&per_page=100`,
        );
        if (!commitsResponse.ok) {
          throw new Error(
            `GitHub API error: ${commitsResponse.status} ${commitsResponse.statusText}`,
          );
        }

        const commits: GitHubCommit[] = await commitsResponse.json();

        // Group by day and get first commit of each day
        const dailyCommits = groupCommitsByDay(commits);

        // Limit to 30 days and sort by date (most recent first)
        const sortedDays = Array.from(dailyCommits.entries())
          .sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime())
          .slice(0, 30);

        // Fetch snapshots for each daily commit
        const dailyDataPromises = sortedDays.map(
          async ([date, commit]): Promise<DailyCommitData> => {
            let snapshot: Record<string, { parsed: number; gzip: number }> | null = null;

            try {
              snapshot = await fetchSnapshot(repo, commit.sha);
            } catch (fetchError) {
              console.warn(`Failed to fetch snapshot for commit ${commit.sha}:`, fetchError);
              // snapshot remains null
            }

            return {
              date,
              commit,
              snapshot,
            };
          },
        );

        const dailyData = await Promise.all(dailyDataPromises);

        // Sort by date (oldest first for chart display)
        return dailyData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } catch (err) {
        console.error('Error fetching daily commit history:', err);
        throw err;
      }
    },
    retry: 1,
    enabled: Boolean(repo),
    staleTime: 5 * 60 * 1000, // Cache commits for 5 minutes
  });

  return {
    dailyData: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}

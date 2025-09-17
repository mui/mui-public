import { useQuery } from '@tanstack/react-query';
import { octokit, parseRepo } from '../utils/github';

export interface CompareInfo {
  mergeBase: string | null;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  status: 'ahead' | 'behind' | 'identical' | 'diverged';
  files: Array<{
    filename: string;
    additions: number;
    deletions: number;
    changes: number;
    status: string;
  }>;
}

export interface UseCompareCommits {
  compareInfo: CompareInfo | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to compare commits and get comprehensive information about the diff
 * @param repo Full repository name in the format "org/repo" (e.g. "mui/material-ui")
 * @param baseRef The base branch reference
 * @param headSha The head SHA of the PR
 */
export function useCompareCommits(
  repo: string,
  baseRef?: string,
  headSha?: string,
): UseCompareCommits {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['github-compare-commits', repo, baseRef, headSha],
    queryFn: async () => {
      if (!baseRef || !headSha) {
        return null;
      }
      const { owner, repo: repoName } = parseRepo(repo);
      const { data: compareData } = await octokit.rest.repos.compareCommits({
        owner,
        repo: repoName,
        base: baseRef,
        head: headSha,
      });

      return {
        mergeBase: compareData.merge_base_commit?.sha || null,
        aheadBy: compareData.ahead_by,
        behindBy: compareData.behind_by,
        totalCommits: compareData.total_commits,
        status: compareData.status as 'ahead' | 'behind' | 'identical' | 'diverged',
        files:
          compareData.files?.map((file) => ({
            filename: file.filename,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            status: file.status,
          })) || [],
      };
    },
    retry: 1,
    enabled: Boolean(repo && baseRef && headSha),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    compareInfo: data,
    isLoading,
    error: error as Error | null,
  };
}

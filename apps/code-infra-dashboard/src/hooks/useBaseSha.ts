import { useSearchParams } from 'next/navigation';
import { useGitHubPR } from './useGitHubPR';
import { useCompareCommits } from './useCompareCommits';

/**
 * Resolves the base SHA for comparison views.
 * Reads `base` (or legacy `baseCommit`) from search params first;
 * falls back to computing the merge base via PR info + GitHub compare API.
 */
export function useBaseSha(
  repo: string,
  sha: string | null,
): { baseSha: string | null; isLoading: boolean } {
  const searchParams = useSearchParams();
  const baseParam = searchParams.get('base') ?? searchParams.get('baseCommit');
  const prNumberParam = searchParams.get('prNumber');
  const prNumber = prNumberParam ? parseInt(prNumberParam, 10) : undefined;

  const { prInfo, isLoading: isPrLoading } = useGitHubPR(repo, !baseParam ? prNumber : undefined);
  const { compareInfo, isLoading: isCompareLoading } = useCompareCommits(
    repo,
    prInfo?.base.ref,
    sha ?? undefined,
  );

  if (baseParam) {
    return { baseSha: baseParam, isLoading: false };
  }

  if (prNumber) {
    return {
      baseSha: compareInfo?.mergeBase ?? null,
      isLoading: isPrLoading || isCompareLoading,
    };
  }

  return { baseSha: null, isLoading: false };
}

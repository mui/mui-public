import { fetchCiReport } from '@/utils/fetchCiReport';
import { fetchCiReportWithFallback } from '@/utils/fetchCiReportWithFallback';
import { calculateSizeDiff } from '@/lib/bundleSize/calculateSizeDiff';
import { buildBundleSizeMarkdownReport } from '@/lib/bundleSize/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';

import type { ReportOptions, ReportResult } from './types';

export const BUNDLE_SIZE_SECTION_TITLE = 'Bundle size';

function getDetailsUrl(
  repo: string,
  prNumber: number,
  baseRef: string,
  baseCommit: string,
  headCommit: string,
) {
  const url = new URL(`${DASHBOARD_ORIGIN}/size-comparison/${repo}/diff`);
  url.searchParams.set('sha', headCommit);
  url.searchParams.set('base', baseCommit);
  url.searchParams.set('prNumber', String(prNumber));
  url.searchParams.set('baseRef', baseRef);
  return url;
}

/**
 * Generates a complete bundle size report by fetching and comparing snapshots.
 * Returns null if the head snapshot is not available.
 */
export async function generateBundleSizeReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber, commitSha, pr, baseCandidates } = options;

  const [baseResult, headSnapshot] = await Promise.all([
    fetchCiReportWithFallback(repo, baseCandidates, 'size-snapshot.json'),
    fetchCiReport(repo, commitSha, 'size-snapshot.json'),
  ]);

  if (!headSnapshot) {
    return null;
  }

  const { report: baseSnapshot, actualCommit: actualBaseCommit } = baseResult;
  const mergeBaseCommit = baseCandidates[0];

  // Extract tracked bundles from snapshot metadata
  // eslint-disable-next-line no-underscore-dangle -- external data format
  const trackedBundles = headSnapshot._metadata?.trackedBundles;

  let markdownContent = '';

  if (!baseSnapshot) {
    markdownContent += `_:no_entry_sign: No bundle size snapshot found for merge base ${mergeBaseCommit} or any of its ${baseCandidates.length - 1} parent commits._\n\n`;
  } else if (actualBaseCommit !== mergeBaseCommit) {
    markdownContent += `_:information_source: Using snapshot from parent commit ${actualBaseCommit} (fallback from merge base ${mergeBaseCommit})._\n\n`;
  }

  const sizeDiff = calculateSizeDiff(baseSnapshot ?? {}, headSnapshot);
  markdownContent += buildBundleSizeMarkdownReport(sizeDiff, {
    track: trackedBundles && trackedBundles.length > 0 ? trackedBundles : undefined,
  });

  const detailsUrl = getDetailsUrl(
    repo,
    prNumber,
    pr.base.ref,
    actualBaseCommit || mergeBaseCommit,
    commitSha,
  );
  markdownContent += `\n\n[Details of bundle changes](${detailsUrl})`;

  return { content: `## ${BUNDLE_SIZE_SECTION_TITLE}\n\n${markdownContent}` };
}

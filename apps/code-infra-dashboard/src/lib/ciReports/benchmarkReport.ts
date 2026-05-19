import { fetchCiReport } from '@/utils/fetchCiReport';
import { fetchCiReportWithFallback } from '@/utils/fetchCiReportWithFallback';
import { compareBenchmarkReports } from '@/lib/benchmark/compareBenchmarkReports';
import { buildBenchmarkMarkdownReport } from '@/lib/benchmark/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';

import type { ReportOptions, ReportResult } from './types';

export const BENCHMARK_SECTION_TITLE = 'Performance';

/**
 * Generates a complete benchmark report by fetching and comparing benchmark results.
 * Returns null if the head benchmark report is not available.
 */
export async function generateBenchmarkReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber, commitSha, pr, baseCandidates } = options;

  const [baseResult, headReport] = await Promise.all([
    fetchCiReportWithFallback(repo, baseCandidates, 'benchmark.json'),
    fetchCiReport(repo, commitSha, 'benchmark.json'),
  ]);

  if (!headReport) {
    return null;
  }

  const inlinedBase = headReport.base;
  const { report: fetchedBaseUpload, actualCommit: actualBaseCommit } = baseResult;
  const fetchedBaseReport = fetchedBaseUpload?.report ?? null;
  const mergeBaseCommit = baseCandidates[0];

  // Prefer the inlined base when present — same-job baseline wins for the PR comment.
  const useInlinedBase = Boolean(inlinedBase);
  const baseReport = useInlinedBase ? (inlinedBase?.report ?? null) : fetchedBaseReport;

  let markdownContent = '';

  if (useInlinedBase) {
    // Inlined base path — no S3 lookup narrative needed.
  } else if (!baseReport) {
    markdownContent += `_:no_entry_sign: No benchmark report found for merge base ${mergeBaseCommit} or any of its ${baseCandidates.length - 1} parent commits._\n\n`;
  } else if (actualBaseCommit !== mergeBaseCommit) {
    markdownContent += `_:information_source: Using benchmark from parent commit ${actualBaseCommit} (fallback from merge base ${mergeBaseCommit})._\n\n`;
  }

  const comparison = compareBenchmarkReports(headReport.report, baseReport);

  const detailsUrl = new URL(`${DASHBOARD_ORIGIN}/benchmark-details/${repo}`);
  detailsUrl.searchParams.set('sha', commitSha);
  // When we inlined the base, omit the `base` query param so the dashboard
  // defaults to the inlined copy rather than re-fetching by sha.
  if (!useInlinedBase) {
    detailsUrl.searchParams.set('base', actualBaseCommit || mergeBaseCommit);
  }
  detailsUrl.searchParams.set('prNumber', String(prNumber));
  detailsUrl.searchParams.set('baseRef', pr.base.ref);

  markdownContent += buildBenchmarkMarkdownReport(comparison, {
    reportUrl: detailsUrl.toString(),
  });

  return { content: `## ${BENCHMARK_SECTION_TITLE}\n\n${markdownContent}` };
}

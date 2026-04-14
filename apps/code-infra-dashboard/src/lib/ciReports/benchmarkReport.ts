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

  const { report: baseReport, actualCommit: actualBaseCommit } = baseResult;
  const mergeBaseCommit = baseCandidates[0];

  let markdownContent = '';

  if (!baseReport) {
    markdownContent += `_:no_entry_sign: No benchmark report found for merge base ${mergeBaseCommit} or any of its ${baseCandidates.length - 1} parent commits._\n\n`;
  } else if (actualBaseCommit !== mergeBaseCommit) {
    markdownContent += `_:information_source: Using benchmark from parent commit ${actualBaseCommit} (fallback from merge base ${mergeBaseCommit})._\n\n`;
  }

  const comparison = compareBenchmarkReports(headReport, baseReport ?? null);

  const detailsUrl = new URL(`${DASHBOARD_ORIGIN}/benchmark-details/${repo}`);
  detailsUrl.searchParams.set('sha', commitSha);
  detailsUrl.searchParams.set('base', actualBaseCommit || mergeBaseCommit);
  detailsUrl.searchParams.set('prNumber', String(prNumber));
  detailsUrl.searchParams.set('baseRef', pr.base.ref);

  markdownContent += buildBenchmarkMarkdownReport(comparison, {
    reportUrl: detailsUrl.toString(),
  });

  return { content: `## ${BENCHMARK_SECTION_TITLE}\n\n${markdownContent}` };
}

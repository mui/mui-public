import { fetchCiReport } from '@/utils/fetchCiReport';
import type { BenchmarkReport } from '@/utils/fetchBenchmarkReport';
import { compareBenchmarkReports } from '@/utils/compareBenchmarkReports';
import { buildBenchmarkMarkdownReport } from '@/utils/buildBenchmarkMarkdownReport';
import { fetchCiReportWithFallback } from '@/lib/ciReports/fetchWithFallback';
import { DASHBOARD_ORIGIN } from '@/constants';

export const BENCHMARK_SECTION_TITLE = 'Performance';

interface PrInfo {
  base: { ref: string };
}

interface BenchmarkReportOptions {
  repo: string;
  prNumber: number;
  commitSha: string;
  pr: PrInfo;
  baseCandidates: string[];
}

export interface BenchmarkReportResult {
  content: string;
}

/**
 * Generates a complete benchmark report by fetching and comparing benchmark results.
 * Returns null if the head benchmark report is not available.
 */
export async function generateBenchmarkReport(
  options: BenchmarkReportOptions,
): Promise<BenchmarkReportResult | null> {
  const { repo, prNumber, commitSha, pr, baseCandidates } = options;

  const [baseResult, headReport] = await Promise.all([
    fetchCiReportWithFallback<BenchmarkReport>(repo, baseCandidates, 'benchmark.json'),
    fetchCiReport<BenchmarkReport>(repo, commitSha, 'benchmark.json'),
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
  detailsUrl.searchParams.set('prNumber', String(prNumber));
  detailsUrl.searchParams.set('baseRef', pr.base.ref);
  detailsUrl.searchParams.set('baseCommit', actualBaseCommit || mergeBaseCommit);
  detailsUrl.searchParams.set('headCommit', commitSha);

  markdownContent += buildBenchmarkMarkdownReport(comparison, {
    reportUrl: detailsUrl.toString(),
  });

  markdownContent += `\n\n[Details of benchmark changes](${detailsUrl})`;

  return { content: `## ${BENCHMARK_SECTION_TITLE}\n\n${markdownContent}` };
}

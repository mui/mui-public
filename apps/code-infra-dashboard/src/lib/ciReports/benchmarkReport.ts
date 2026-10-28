import { fetchCiReport, isBenchmarkRunUpload } from '@/utils/fetchCiReport';
import { fetchCiReportWithFallback } from '@/utils/fetchCiReportWithFallback';
import { compareBenchmarkReports } from '@/lib/benchmark/compareBenchmarkReports';
import { buildBenchmarkMarkdownReport } from '@/lib/benchmark/buildMarkdownReport';
import { buildBenchmarkRunMarkdownReport } from '@/lib/benchmarkRun/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';

import type { BenchmarkRunReport } from '@mui/internal-benchmark/runReport';
import type { ReportOptions, ReportResult } from './types';

export const BENCHMARK_SECTION_TITLE = 'Performance';

/** A version 2 report measured its own baseline in the same run, so it is rendered on its own. */
function generateBenchmarkRunSection(
  { repo, prNumber, commitSha }: ReportOptions,
  report: BenchmarkRunReport,
): ReportResult {
  const runUrl = new URL(`${DASHBOARD_ORIGIN}/benchmark-run/${repo}`);
  runUrl.searchParams.set('sha', commitSha);
  // The details view reads this to title the page and link back to the PR overview.
  runUrl.searchParams.set('prNumber', String(prNumber));
  return {
    content: buildBenchmarkRunMarkdownReport(report, {
      title: BENCHMARK_SECTION_TITLE,
      detailsUrl: runUrl.href,
    }),
  };
}

/**
 * Generates the benchmark section of the pull request comment from the head commit's report.
 * Returns null if the head benchmark report is not available.
 *
 * A version 2 report measured its own baseline in the same run, so it is rendered on its own. A
 * version 1 report is compared against the base commit's report, fetched separately — which has to
 * be version 1 too, since the two shapes cannot be compared.
 */
export async function generateBenchmarkReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber, commitSha, pr, baseCandidates } = options;

  // Started before the head is known so a version 1 report does not wait for it twice; a version 2
  // report does not need it, and returns without waiting for it at all.
  const baseResultPromise = fetchCiReportWithFallback(repo, baseCandidates, 'benchmark.json');
  baseResultPromise.catch(() => {});

  const headReport = await fetchCiReport(repo, commitSha, 'benchmark.json');
  if (!headReport) {
    return null;
  }
  if (isBenchmarkRunUpload(headReport)) {
    return generateBenchmarkRunSection(options, headReport.report);
  }

  const baseResult = await baseResultPromise;
  const inlinedBase = headReport.base;
  const { actualCommit: actualBaseCommit } = baseResult;
  const fetchedBaseUpload =
    baseResult.report && !isBenchmarkRunUpload(baseResult.report) ? baseResult.report : null;
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

  const baseUpload = useInlinedBase ? inlinedBase : fetchedBaseUpload;
  const comparison = compareBenchmarkReports(headReport, baseUpload ?? null);

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

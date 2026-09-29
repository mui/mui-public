import { fetchCiReport } from '@/utils/fetchCiReport';
import {
  buildBenchmarkRunMarkdownReport,
  BENCHMARK_RUN_SECTION_TITLE,
} from '@/lib/benchmarkRun/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';
import type { ReportOptions, ReportResult } from './types';

export { BENCHMARK_RUN_SECTION_TITLE };

/**
 * Generates the benchmarks section of the pull request comment. The run measured its own baseline,
 * so there is no base report to fetch: only the head commit's.
 */
export async function generateBenchmarkRunReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber, commitSha } = options;

  const report = await fetchCiReport(repo, commitSha, 'benchmark-run.json');
  if (!report) {
    return null;
  }

  const detailsUrl = new URL(`${DASHBOARD_ORIGIN}/benchmark-run/${repo}`);
  detailsUrl.searchParams.set('sha', commitSha);
  // The details view reads this to title the page and link back to the PR overview.
  detailsUrl.searchParams.set('prNumber', String(prNumber));

  return {
    content: buildBenchmarkRunMarkdownReport(report, { detailsUrl: detailsUrl.href }),
  };
}

import { fetchCiReport } from '@/utils/fetchCiReport';
import {
  buildTachometerMarkdownReport,
  TACHOMETER_SECTION_TITLE,
} from '@/lib/tachometer/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';

import type { TachometerReport } from '@mui/internal-benchmark/tachometerReport';
import type { ReportOptions, ReportResult } from './types';

export { TACHOMETER_SECTION_TITLE };

/**
 * Generates the tachometer section of the pull request comment.
 */
export async function generateTachometerReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, prNumber, commitSha } = options;

  const report: TachometerReport | null = await fetchCiReport(repo, commitSha, 'tachometer.json');
  if (!report?.cases) {
    return null;
  }

  const detailsUrl = new URL(`${DASHBOARD_ORIGIN}/tachometer-details/${repo}`);
  detailsUrl.searchParams.set('sha', commitSha);
  // The details view reads this to title the page and link back to the PR overview.
  detailsUrl.searchParams.set('prNumber', String(prNumber));

  return {
    content: buildTachometerMarkdownReport(report, { detailsUrl: detailsUrl.href }),
  };
}

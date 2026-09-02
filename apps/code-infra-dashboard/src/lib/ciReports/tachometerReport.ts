import { fetchCiReport } from '@/utils/fetchCiReport';
import {
  buildTachometerMarkdownReport,
  TACHOMETER_SECTION_TITLE,
} from '@/lib/tachometer/buildMarkdownReport';
import { DASHBOARD_ORIGIN } from '@/constants';

import type { TachometerUpload } from '@/lib/tachometer/types';
import type { ReportOptions, ReportResult } from './types';

export { TACHOMETER_SECTION_TITLE };

/**
 * Generates the tachometer section of the pull request comment.
 *
 * Unlike the benchmark section, this fetches exactly one artifact and does no comparison. A
 * tachometer report already contains both sides: `[current]` and `[baseline]` are sampled
 * round-robin in a single browser session, and the report carries tachometer's own confidence
 * interval on the difference. There is no base report to look up, and so no chance of pairing
 * against a mismatched one.
 *
 * Returns null when the head commit has no report, which is how a repository that did not run the
 * job produces no section at all.
 */
export async function generateTachometerReport(
  options: ReportOptions,
): Promise<ReportResult | null> {
  const { repo, commitSha } = options;

  const upload: TachometerUpload | null = await fetchCiReport(repo, commitSha, 'tachometer.json');
  if (!upload?.report) {
    return null;
  }

  const detailsUrl = new URL(`${DASHBOARD_ORIGIN}/tachometer-details/${repo}`);
  detailsUrl.searchParams.set('sha', commitSha);

  return {
    content: buildTachometerMarkdownReport(upload.report, { detailsUrl: detailsUrl.href }),
  };
}

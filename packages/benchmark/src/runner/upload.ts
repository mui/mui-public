/* eslint-disable no-console -- progress belongs in the CI log. */

import chalk from 'chalk';
import { postToDashboard } from '../ciApi';
import { ciReportUploadSchema, getCiMetadata } from '../ciReport';
import { syncPrComment } from '../syncPrComment';
import { benchmarkRunReportSchema } from '../runReport';
import type { BenchmarkRunReport } from '../runReport';

/**
 * Version 2 of the `benchmark` upload. It shares the report type with the Vitest reporter's version
 * 1 — and so the commit's one `benchmark.json` — so a repository uploads one or the other; the
 * dashboard reads each by its version.
 */
const benchmarkUploadV2Schema = ciReportUploadSchema('benchmark', 2, benchmarkRunReportSchema);

/**
 * Uploads a report and refreshes the pull request comment.
 *
 * Validates before sending because the server stores `report` without inspecting it. A failure to
 * refresh the comment does not fail the run: the numbers are already measured, written and
 * uploaded, and losing them to a comment API hiccup would waste the whole run.
 */
export async function publishRunReport(report: BenchmarkRunReport): Promise<void> {
  const metadata = await getCiMetadata();
  if (!metadata.repo) {
    console.warn(
      chalk.yellow('Skipping upload: no repository detected, which usually means this is not CI.'),
    );
    return;
  }

  const upload = benchmarkUploadV2Schema.parse({
    version: 2,
    reportType: 'benchmark',
    ...metadata,
    report,
  });
  const responseText = await postToDashboard(
    '/api/ci-reports/upload',
    upload,
    'The benchmark upload',
  );
  console.log(`Benchmark report uploaded. S3 key: ${JSON.parse(responseText).key}`);

  try {
    console.log('Syncing PR comment via the dashboard API…');
    const result = await syncPrComment(metadata.repo);
    console.log(
      result.skipped ? 'No open PR found for this branch, skipping.' : 'PR comment synced.',
    );
  } catch (error) {
    console.error(
      chalk.yellow(
        `Failed to sync the PR comment: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}

/* eslint-disable no-console -- progress belongs in the CI log. */

import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { postToDashboard } from '../ciApi';
import { getCiMetadata } from '../ciReport';
import { syncPrComment } from '../syncPrComment';
import { benchmarkRunReportSchema, benchmarkRunUploadSchema } from '../runReport';
import type { BenchmarkRunReport } from '../runReport';

/**
 * Uploads a report and refreshes the pull request comment.
 *
 * Validates before sending because the server stores `report` without inspecting it. A failure to
 * refresh the comment does not fail the run: the numbers are already measured, written and
 * uploaded, and losing them to a comment API hiccup would waste the whole run.
 */
export async function publishRunReport(
  report: BenchmarkRunReport,
  timeline: string | undefined,
): Promise<void> {
  const metadata = await getCiMetadata();
  if (!metadata.repo) {
    console.warn(
      chalk.yellow('Skipping upload: no repository detected, which usually means this is not CI.'),
    );
    return;
  }

  const upload = benchmarkRunUploadSchema.parse({
    version: 2,
    reportType: 'benchmark',
    ...metadata,
    timeline,
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

/**
 * Uploads a report file that `benchmark` wrote, and refreshes the pull request comment.
 *
 * The dashboard files the report under the commit CI is building, so a report measured on another
 * commit is refused rather than filed under the wrong one.
 */
export async function uploadReportFile(file: string, timeline: string | undefined): Promise<void> {
  const report = benchmarkRunReportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const { commitSha } = await getCiMetadata();
  if (commitSha && report.head.sha && report.head.sha !== commitSha) {
    throw new Error(
      `${file} was measured on ${report.head.sha}, but CI is building ${commitSha}. Upload a report from this commit's run.`,
    );
  }
  await publishRunReport(report, timeline);
}

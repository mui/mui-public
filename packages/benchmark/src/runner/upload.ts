/* eslint-disable no-console -- progress belongs in the CI log. */

import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { postToDashboard } from '../ciApi';
import { getCiMetadata } from '../ciReport';
import { syncPrComment } from '../syncPrComment';
import { benchmarkRunReportSchema, benchmarkRunUploadSchema } from '../runReport';
import { resultsPathOf } from './outputDir';

export interface UploadReportOptions {
  /** The harness package directory, where a run writes its report by default. */
  harnessDir: string;
  /** The report to upload. Defaults to the one a run writes, `.benchmark/results/report.json`. */
  file?: string;
  /** The dashboard timeline to upload into, in place of the branch's. */
  timeline?: string;
}

/**
 * Uploads a report that a `benchmark` run wrote, and refreshes the pull request comment.
 *
 * The dashboard files the report under the commit CI is building, so a report measured on another
 * commit is refused rather than filed under the wrong one. Validates before sending because the
 * server stores `report` without inspecting it. A failure to refresh the comment does not fail the
 * upload: the report has landed, and the next sync shows it.
 */
export async function uploadReportFile(options: UploadReportOptions): Promise<void> {
  const file = options.file ? path.resolve(options.file) : resultsPathOf(options.harnessDir);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No report at ${file}: the run failed before writing one.`);
    }
    throw error;
  }
  const report = benchmarkRunReportSchema.parse(JSON.parse(text));

  const metadata = await getCiMetadata();
  if (!metadata.repo) {
    console.warn(
      chalk.yellow('Skipping upload: no repository detected, which usually means this is not CI.'),
    );
    return;
  }
  if (report.head.sha !== metadata.commitSha) {
    throw new Error(
      `${file} was measured on ${report.head.sha}, but CI is building ${metadata.commitSha}. Upload a report from this commit's run.`,
    );
  }

  const upload = benchmarkRunUploadSchema.parse({
    version: 2,
    reportType: 'benchmark',
    ...metadata,
    timeline: options.timeline,
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

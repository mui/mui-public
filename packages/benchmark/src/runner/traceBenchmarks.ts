/* eslint-disable no-console */

import * as path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import chalk from 'chalk';
import type { Browser } from '@playwright/test';
import type { RunBenchmark } from '../runReport';
import {
  errorMessage,
  loadBenchPage,
  openBenchTab,
  sampleBenchCase,
  shuffledIndices,
  withPlannedRun,
} from './runInterleaved';
import type { MeasuredBenchmark, RunInterleavedOptions } from './runInterleaved';

/**
 * Records benchmarks instead of measuring them, to show where their time goes: every sample runs as
 * it would be measured — the first iteration of a freshly loaded page, in one tab, the variants
 * alternating — with a performance trace recorded around it, to open in DevTools' Performance
 * panel. Tracing slows the code it records, so nothing here is a measurement.
 */

export interface BenchmarkTraces extends Pick<RunBenchmark, 'name' | 'file' | 'kind'> {
  /** Per variant, its samples' trace files in the order they ran. */
  traces: Record<string, string[]>;
  error?: string;
}

async function traceBenchmark(
  browser: Browser,
  { entry, slots, sampling }: MeasuredBenchmark,
  tracesDir: string,
): Promise<BenchmarkTraces> {
  console.log(chalk.cyan(`\nTracing "${entry.name}" (${entry.file})…`));
  const outDir = path.join(tracesDir, entry.name.replace(/[^\w.-]+/g, '-'));
  const traces: Record<string, string[]> = Object.fromEntries(
    slots.map((slot) => [slot.variant, []]),
  );
  const page = await openBenchTab(browser);
  try {
    await mkdir(outDir, { recursive: true });
    for (let round = 1; round <= sampling.sampleSize; round += 1) {
      for (const index of shuffledIndices(slots.length)) {
        const { variant, url, caseName } = slots[index];
        const file = path.join(outDir, `${variant}-${round}.json`);
        // eslint-disable-next-line no-await-in-loop
        await loadBenchPage(page, url);
        // eslint-disable-next-line no-await-in-loop
        await browser.startTracing(page, { path: file });
        // eslint-disable-next-line no-await-in-loop
        await sampleBenchCase(page, caseName);
        // eslint-disable-next-line no-await-in-loop
        await browser.stopTracing();
        traces[variant].push(file);
      }
    }
    return { name: entry.name, file: entry.file, kind: entry.kind, traces };
  } catch (error) {
    console.error(chalk.red(`  ${errorMessage(error)}`));
    return {
      name: entry.name,
      file: entry.file,
      kind: entry.kind,
      traces,
      error: errorMessage(error),
    };
  } finally {
    await page.context().close();
  }
}

/** Traces every benchmark the run was asked for, one after another, into `tracesDir`. */
export async function traceBenchmarks(
  options: RunInterleavedOptions & { tracesDir: string },
): Promise<BenchmarkTraces[]> {
  await rm(options.tracesDir, { recursive: true, force: true });
  return withPlannedRun(options, async ({ browser, planned }) => {
    const results: BenchmarkTraces[] = [];
    // Sequential on purpose: a browser records one trace at a time.
    for (const plan of planned) {
      if ('error' in plan) {
        const { name, file, kind } = plan.entry;
        results.push({ name, file, kind, traces: {}, error: plan.error });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await traceBenchmark(browser, plan, options.tracesDir));
    }
    return results;
  });
}

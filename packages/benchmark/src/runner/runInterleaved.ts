/* eslint-disable no-console */

import chalk from 'chalk';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS } from '../launchArgs';
import type { RunBenchmark, RunMetricDefinition } from '../runReport';
import type { BenchFile } from './benchFiles';
import { variantOf } from './refs';
import type { ResolvedRef } from './refs';
import { serveDirectory } from './serveDirectory';
// Types for `window.benchmarkPage`, which the evaluated functions below call into.
import type {} from '../page/page';

/**
 * Runs the cases of `*.bench.tsx` files in Playwright. Every variant gets a page of its own, in a
 * browser context of its own, that stays open for the whole benchmark: every sample is one
 * iteration, so module-scope data and the JIT stay warm, and interactions get trusted input through
 * a CDP session the page is bridged to. Variants are sampled once per round in a shuffled order, so
 * the samples are round-aligned and can be compared on paired differences.
 */

export interface RunInterleavedOptions {
  /** Where each ref's pages were built, one directory per ref id. */
  buildsDir: string;
  benchFiles: BenchFile[];
  /** The builds a benchmark file compares: the working tree first, then the baseline. */
  benchRefs: ResolvedRef[];
  browserBinary: string;
  launchArgs: string[];
  samples: number;
  /** Discarded rounds before measuring, once per case. */
  warmup: number;
}

export interface InterleavedResults {
  benchmarks: RunBenchmark[];
  metrics: Record<string, RunMetricDefinition>;
  /** The browser as it reports itself, e.g. `151.0.7922.34`. */
  browserVersion: string;
}

const VIEWPORT = { width: 1920, height: 1080 };
const SAMPLE_TIMEOUT_MS = 120_000;

type CdpMethod = Parameters<CDPSession['send']>[0];

/** One measured round: every variant's values by metric name, in slot order. */
type Round = Array<Record<string, number>>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** A random permutation of `0..length-1`, so no variant always runs first in its round. */
function shuffledIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap], indices[index]];
  }
  return indices;
}

/**
 * The metrics every variant reported in every round. One some iteration did not produce — a
 * per-phase render split that only sometimes has a second phase, say — cannot be paired round by
 * round, so it is left out.
 */
function stableMetrics(rounds: Round[]): string[] {
  const [first] = rounds;
  return Object.keys(first?.[0] ?? {}).filter((metric) =>
    rounds.every((round) => round.every((values) => values[metric] !== undefined)),
  );
}

/** What a benchmark file's page defines. */
interface PageListing {
  /** The cases measured across the builds. */
  caseNames: string[];
  /** The cases measured against each other, on the working tree's build. */
  comparisons: Array<{ name: string; cases: string[] }>;
}

interface OpenedPage {
  context: BrowserContext;
  page: Page;
  listing: PageListing;
}

async function openBenchPage(browser: Browser, url: string): Promise<OpenedPage> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(SAMPLE_TIMEOUT_MS);
  page.on('pageerror', (error) => console.error(chalk.red(`  page error: ${error.message}`)));
  const session = await context.newCDPSession(page);
  // Interactions ask for trusted input through this bridge. `send` only accepts the protocol
  // methods Playwright knows by name; the page may ask for any, and Chrome rejects unknown ones.
  await page.exposeBinding(
    'benchmarkCdp',
    (_source, method: string, params?: Record<string, unknown>) =>
      session.send(method as CdpMethod, params),
  );
  await page.goto(url);
  const ready = await page.waitForFunction(() => {
    if (window.benchmarkPage === undefined) {
      return false;
    }
    return {
      visibility: document.visibilityState,
      caseNames: window.benchmarkPage.caseNames(),
      comparisons: window.benchmarkPage.comparisons(),
    };
  });
  const state = await ready.jsonValue();
  if (!state) {
    await context.close();
    throw new Error(`${url} never got ready.`);
  }
  if (state.visibility !== 'visible') {
    console.warn(chalk.yellow(`  ${url} is ${state.visibility}; rAF-based waits may stall.`));
  }
  return { context, page, listing: state };
}

async function closeBenchPages(targets: OpenedPage[]): Promise<void> {
  await Promise.all(targets.map((target) => target.context.close()));
}

async function openBenchPages(browser: Browser, urls: string[]): Promise<OpenedPage[]> {
  const settled = await Promise.allSettled(urls.map((url) => openBenchPage(browser, url)));
  const opened = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) {
    await closeBenchPages(opened);
    throw failed.reason;
  }
  return opened;
}

/** Opens pages just to learn what they define; every benchmark then measures in fresh ones. */
async function listBenchPages(browser: Browser, urls: string[]): Promise<PageListing[]> {
  const opened = await openBenchPages(browser, urls);
  await closeBenchPages(opened);
  return opened.map((target) => target.listing);
}

/**
 * Runs one iteration of a case. A measured one comes back as its `performance.measure` values by
 * name, read in the same round trip.
 */
function sampleBenchCase(
  page: Page,
  name: string,
  warmup: boolean,
): Promise<Record<string, number> | null> {
  return page.evaluate(
    async (args) => {
      await window.benchmarkPage!.sample(args.name, { warmup: args.warmup });
      if (args.warmup) {
        return null;
      }
      const values: Record<string, number> = {};
      for (const measure of performance.getEntriesByType('measure') as PerformanceMeasure[]) {
        const detailValue: unknown = measure.detail?.value;
        const value = typeof detailValue === 'number' ? detailValue : measure.duration;
        // A metric recorded more than once in an iteration counts its total for that iteration.
        values[measure.name] = (values[measure.name] ?? 0) + value;
      }
      return values;
    },
    { name, warmup },
  );
}

/**
 * A variant of a benchmark: the page it is sampled in and the case it runs there. One build of a
 * benchmark file running a case, or the working tree's build running one case of a `compare()`.
 */
interface PageSlot {
  /** How the slot is named in the report: `current`, `baseline`, or the compared case's name. */
  variant: string;
  url: string;
  caseName: string;
}

interface CaseMeasurement {
  rounds: Round[];
  metrics: Record<string, RunMetricDefinition>;
}

/**
 * Measures one benchmark in fresh pages that stay open for all of it, so iterations stay warm and
 * module-scope data is built once. Warmup and measured rounds alike run every slot once, in a
 * shuffled order.
 */
async function measureBenchmark(
  browser: Browser,
  slots: PageSlot[],
  options: RunInterleavedOptions,
): Promise<CaseMeasurement> {
  const targets = await openBenchPages(
    browser,
    slots.map((slot) => slot.url),
  );
  const sampleSlot = (index: number, warmup: boolean) =>
    sampleBenchCase(targets[index].page, slots[index].caseName, warmup);
  try {
    for (let roundIndex = 0; roundIndex < options.warmup; roundIndex += 1) {
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        await sampleSlot(index, true);
      }
    }
    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < options.samples; roundIndex += 1) {
      const round: Round = [];
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        round[index] = (await sampleSlot(index, false)) ?? {};
      }
      rounds.push(round);
    }
    // Read from the reference page: a metric whose config the change under test altered is
    // described the way the change describes it.
    const metrics = await targets[0].page.evaluate(() => window.benchmarkPage!.metricDefinitions());
    return { rounds, metrics };
  } finally {
    await closeBenchPages(targets);
  }
}

/** The round-aligned samples of a benchmark, per variant and metric. */
function samplesOf(slots: PageSlot[], rounds: Round[]): RunBenchmark['samples'] {
  const metrics = stableMetrics(rounds);
  return Object.fromEntries(
    slots.map((slot, index) => [
      slot.variant,
      Object.fromEntries(
        metrics.map((metric) => [metric, rounds.map((round) => round[index][metric])]),
      ),
    ]),
  );
}

/** A benchmark as it goes into the report, with the definitions of the metrics it reported. */
interface CaseResult {
  benchmark: RunBenchmark;
  metrics: Record<string, RunMetricDefinition>;
}

type BenchmarkEntry = Pick<RunBenchmark, 'name' | 'file' | 'kind' | 'variants'>;

/** Measures one benchmark across its slots, or reports the error that stopped it. */
async function runBenchmark(
  browser: Browser,
  entry: BenchmarkEntry,
  slots: PageSlot[],
  options: RunInterleavedOptions,
): Promise<CaseResult> {
  console.log(chalk.cyan(`\nRunning "${entry.name}" (${entry.file})…`));
  try {
    const measured = await measureBenchmark(browser, slots, options);
    return {
      benchmark: { ...entry, samples: samplesOf(slots, measured.rounds) },
      metrics: measured.metrics,
    };
  } catch (error) {
    console.error(chalk.red(`  ${errorMessage(error)}`));
    return { benchmark: { ...entry, error: errorMessage(error) }, metrics: {} };
  }
}

function benchPageUrl(origin: string, ref: ResolvedRef, benchFile: BenchFile): string {
  return new URL(`${ref.id}/${benchFile.page}`, `${origin}/`).href;
}

/**
 * Runs a benchmark file: each case on its own across the builds, paired by name with the working
 * tree as the reference, and each `compare()` across its cases on the working tree's build.
 */
async function runBenchFile(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  options: RunInterleavedOptions,
): Promise<CaseResult[]> {
  const urls = options.benchRefs.map((ref) => benchPageUrl(origin, ref, benchFile));
  const variants = options.benchRefs.map(variantOf);
  const [reference, ...others] = await listBenchPages(browser, urls);

  const results: CaseResult[] = [];
  for (const caseName of reference.caseNames) {
    const entry: BenchmarkEntry = {
      name: caseName,
      file: benchFile.file,
      kind: 'baseline',
      variants,
    };
    const missing = others.findIndex((listing) => !listing.caseNames.includes(caseName));
    if (missing !== -1) {
      // A case added by the change under test has nothing to compare with.
      results.push({
        benchmark: {
          ...entry,
          error: `"${caseName}" does not exist in [${variants[missing + 1]}].`,
        },
        metrics: {},
      });
      continue;
    }
    const slots = urls.map((url, index) => ({ variant: variants[index], url, caseName }));
    // eslint-disable-next-line no-await-in-loop
    results.push(await runBenchmark(browser, entry, slots, options));
  }

  for (const { name, cases } of reference.comparisons) {
    const entry: BenchmarkEntry = { name, file: benchFile.file, kind: 'compare', variants: cases };
    const slots = cases.map((caseName) => ({ variant: caseName, url: urls[0], caseName }));
    // eslint-disable-next-line no-await-in-loop
    results.push(await runBenchmark(browser, entry, slots, options));
  }
  return results;
}

export async function runInterleaved(options: RunInterleavedOptions): Promise<InterleavedResults> {
  const { chromium } = await import('@playwright/test');
  const [server, browser] = await Promise.all([
    serveDirectory(options.buildsDir),
    chromium.launch({
      executablePath: options.browserBinary,
      headless: true,
      args: [...BENCHMARK_LAUNCH_ARGS, ...options.launchArgs],
    }),
  ]);

  try {
    const results: CaseResult[] = [];
    // Sequential on purpose: concurrent cases would contend for the same machine.
    for (const benchFile of options.benchFiles) {
      // eslint-disable-next-line no-await-in-loop
      results.push(...(await runBenchFile(browser, server.origin, benchFile, options)));
    }
    return {
      benchmarks: results.map((result) => result.benchmark),
      metrics: Object.assign({}, ...results.map((result) => result.metrics)),
      browserVersion: browser.version(),
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

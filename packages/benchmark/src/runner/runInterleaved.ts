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
 * Runs the `benchmark()` cases of `*.bench.tsx` files in Playwright. Every variant gets a page of
 * its own, in a browser context of its own, that stays open for the whole case: every sample is one
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

/**
 * A page a benchmark file's cases are measured in: one build of the file, or one variant of a
 * `compare()` in it.
 */
interface PageSlot {
  /** How the slot is named in the report: `current`, `baseline`, or the variant's key. */
  variant: string;
  url: string;
}

interface OpenedPage {
  slot: PageSlot;
  context: BrowserContext;
  page: Page;
  caseNames: string[];
  comparisons: Array<{ name: string; variants: string[] }>;
}

async function openBenchPage(browser: Browser, slot: PageSlot): Promise<OpenedPage> {
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
  await page.goto(slot.url);
  const ready = await page.waitForFunction(() => {
    if (window.benchmarkPageError !== undefined) {
      return { error: window.benchmarkPageError };
    }
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
    throw new Error(`${slot.url} never got ready.`);
  }
  if ('error' in state) {
    await context.close();
    throw new Error(`${slot.url} could not get ready: ${state.error}`);
  }
  if (state.visibility !== 'visible') {
    console.warn(chalk.yellow(`  ${slot.url} is ${state.visibility}; rAF-based waits may stall.`));
  }
  return { slot, context, page, caseNames: state.caseNames, comparisons: state.comparisons };
}

async function closeBenchPages(targets: OpenedPage[]): Promise<void> {
  await Promise.all(targets.map((target) => target.context.close()));
}

async function openBenchPages(browser: Browser, slots: PageSlot[]): Promise<OpenedPage[]> {
  const settled = await Promise.allSettled(slots.map((slot) => openBenchPage(browser, slot)));
  const opened = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) {
    await closeBenchPages(opened);
    throw failed.reason;
  }
  return opened;
}

/**
 * Runs one iteration of a case. A measured one comes back as its `performance.measure` values by
 * name, read in the same round trip.
 */
function sampleBenchCase(
  target: OpenedPage,
  name: string,
  warmup: boolean,
): Promise<Record<string, number> | null> {
  return target.page.evaluate(
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

interface CaseMeasurement {
  rounds: Round[];
  metrics: Record<string, RunMetricDefinition>;
}

/**
 * Measures one case in fresh pages that stay open for the whole case, so iterations stay warm and
 * module-scope data is built once. Warmup and measured rounds alike run every slot once, in a
 * shuffled order.
 */
async function measureBenchCase(
  browser: Browser,
  slots: PageSlot[],
  name: string,
  options: RunInterleavedOptions,
): Promise<CaseMeasurement> {
  const targets = await openBenchPages(browser, slots);
  try {
    for (let roundIndex = 0; roundIndex < options.warmup; roundIndex += 1) {
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        await sampleBenchCase(targets[index], name, true);
      }
    }
    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < options.samples; roundIndex += 1) {
      const round: Round = [];
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        round[index] = (await sampleBenchCase(targets[index], name, false)) ?? {};
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

/** The round-aligned samples of a case, per variant and metric. */
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

interface CaseGroup {
  kind: RunBenchmark['kind'];
  file: string;
  nameOf: (caseName: string) => string;
}

/**
 * Runs every case the first listed page defines across all of them, paired by name. The first page
 * is the reference; a case another page lacks is reported as an error rather than compared with
 * nothing.
 */
async function runListedCases(
  browser: Browser,
  listed: OpenedPage[],
  group: CaseGroup,
  options: RunInterleavedOptions,
): Promise<CaseResult[]> {
  const slots = listed.map((target) => target.slot);
  const variants = slots.map((slot) => slot.variant);
  const [reference, ...others] = listed;
  const results: CaseResult[] = [];
  for (const caseName of reference.caseNames) {
    const entry = { name: group.nameOf(caseName), file: group.file, kind: group.kind, variants };
    const missing = others.find((target) => !target.caseNames.includes(caseName));
    if (missing) {
      // A case added by the change under test, or one library lacks, has nothing to compare with.
      results.push({
        benchmark: {
          ...entry,
          error: `"${caseName}" does not exist in [${missing.slot.variant}].`,
        },
        metrics: {},
      });
      continue;
    }

    console.log(chalk.cyan(`\nRunning "${entry.name}" (${group.file})…`));
    try {
      // eslint-disable-next-line no-await-in-loop
      const measured = await measureBenchCase(browser, slots, caseName, options);
      results.push({
        benchmark: { ...entry, samples: samplesOf(slots, measured.rounds) },
        metrics: measured.metrics,
      });
    } catch (error) {
      console.error(chalk.red(`  ${errorMessage(error)}`));
      results.push({ benchmark: { ...entry, error: errorMessage(error) }, metrics: {} });
    }
  }
  return results;
}

/** Opens a set of pages just to learn what they define, then runs their cases. */
async function listAndRun(
  browser: Browser,
  slots: PageSlot[],
  group: CaseGroup,
  options: RunInterleavedOptions,
): Promise<{ results: CaseResult[]; comparisons: OpenedPage['comparisons'] }> {
  // Every case then measures in fresh pages of its own.
  const listed = await openBenchPages(browser, slots);
  await closeBenchPages(listed);
  return {
    results: await runListedCases(browser, listed, group, options),
    comparisons: listed[0].comparisons,
  };
}

function benchPageUrl(origin: string, ref: ResolvedRef, benchFile: BenchFile): URL {
  return new URL(`${ref.id}/${benchFile.page}`, `${origin}/`);
}

/**
 * Runs a benchmark file: its own `benchmark()` cases across the builds, and each `compare()` in it
 * across its variants, every variant built from the working tree.
 */
async function runBenchFile(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  options: RunInterleavedOptions,
): Promise<CaseResult[]> {
  const buildSlots = options.benchRefs.map((ref): PageSlot => ({
    variant: variantOf(ref),
    url: benchPageUrl(origin, ref, benchFile).href,
  }));
  const { results, comparisons } = await listAndRun(
    browser,
    buildSlots,
    { kind: 'baseline', file: benchFile.file, nameOf: (caseName) => caseName },
    options,
  );

  const [worktreeRef] = options.benchRefs;
  for (const { name: comparison, variants } of comparisons) {
    const variantSlots = variants.map((variant): PageSlot => {
      const url = benchPageUrl(origin, worktreeRef, benchFile);
      url.searchParams.set('compare', comparison);
      url.searchParams.set('variant', variant);
      return { variant, url: url.href };
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const compared = await listAndRun(
        browser,
        variantSlots,
        {
          kind: 'compare',
          file: benchFile.file,
          nameOf: (caseName) => `${comparison} / ${caseName}`,
        },
        options,
      );
      results.push(...compared.results);
    } catch (error) {
      console.error(chalk.red(`  ${errorMessage(error)}`));
      results.push({
        benchmark: {
          name: comparison,
          file: benchFile.file,
          kind: 'compare',
          variants,
          error: errorMessage(error),
        },
        metrics: {},
      });
    }
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

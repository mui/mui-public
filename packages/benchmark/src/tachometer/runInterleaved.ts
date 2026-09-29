/* eslint-disable no-console */

import chalk from 'chalk';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS } from '../launchArgs';
import type { CaseComparison } from './discoverCases';
import type { BenchFile } from './benchFiles';
import type { ResolvedRef } from './refs';
import { serveDirectory } from './serveDirectory';
import { shuffledIndices, stableMeasurements, toTachometerJson } from './pairedStats';
import type { Round } from './pairedStats';
import type { CaseRun, SummarizedCaseShape } from './summarizeCase';
// Types for `window.benchmarkPage`, which the evaluated functions below call into.
import type {} from '../page/page';

/**
 * The interleaved engine: runs the `benchmark()` cases of `*.bench.tsx` files in Playwright instead
 * of tachometer. Every variant gets a page of its own, in a browser context of its own, that stays
 * open for the whole case: every sample is one iteration, so module-scope data and the JIT stay
 * warm, and interactions get trusted input through a CDP session the page is bridged to. Variants
 * are sampled once per round in a shuffled order and compared on paired differences.
 */

export interface RunInterleavedOptions {
  /** Where each ref's pages were built, one directory per ref id. */
  buildsDir: string;
  benchFiles: BenchFile[];
  /** The builds a benchmark file compares: the working tree first, then the baseline. */
  benchRefs: ResolvedRef[];
  browserBinary: string;
  asRoot: boolean;
  /** Measured rounds per case. Defaults to 30. */
  samples?: number;
  /** Discarded rounds before measuring, once per case. Defaults to 10. */
  warmup?: number;
}

const VIEWPORT = { width: 1920, height: 1080 };
const DEFAULT_SAMPLES = 30;
const DEFAULT_WARMUP = 10;
const SAMPLE_TIMEOUT_MS = 120_000;

type CdpMethod = Parameters<CDPSession['send']>[0];

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
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

/** Runs one iteration; a measured one comes back as its `performance.measure` values by name. */
async function sampleBenchCase(
  target: OpenedPage,
  name: string,
  warmup: boolean,
): Promise<Record<string, number> | undefined> {
  await target.page.evaluate((args) => window.benchmarkPage!.sample(args.name, args.options), {
    name,
    options: { warmup },
  });
  if (warmup) {
    return undefined;
  }
  return target.page.evaluate(() => {
    const values: Record<string, number> = {};
    for (const measure of performance.getEntriesByType('measure') as PerformanceMeasure[]) {
      const detailValue: unknown = measure.detail?.value;
      const value = typeof detailValue === 'number' ? detailValue : measure.duration;
      // A metric recorded more than once in an iteration counts its total for that iteration.
      values[measure.name] = (values[measure.name] ?? 0) + value;
    }
    return values;
  });
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
): Promise<Round[]> {
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const rounds: Round[] = [];
  const targets = await openBenchPages(browser, slots);
  try {
    for (let roundIndex = 0; roundIndex < warmup + samples; roundIndex += 1) {
      const round: Round = [];
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        round[index] = await sampleBenchCase(targets[index], name, roundIndex < warmup);
      }
      if (roundIndex >= warmup) {
        rounds.push(round);
      }
    }
  } finally {
    await closeBenchPages(targets);
  }
  return rounds;
}

function entryOf(
  name: string,
  comparison: CaseComparison,
  slots: PageSlot[],
  measurements: string[] = [],
): SummarizedCaseShape {
  return {
    name,
    comparison,
    variants: slots.map((slot) => `${name} [${slot.variant}]`),
    measurements,
  };
}

/**
 * Runs every case the first listed page defines across all of them, paired by name. The first page
 * is the reference; a case another page lacks is reported as an error rather than compared with
 * nothing.
 */
async function runListedCases(
  browser: Browser,
  listed: OpenedPage[],
  describe: { comparison: CaseComparison; nameOf: (caseName: string) => string; file: string },
  options: RunInterleavedOptions,
): Promise<CaseRun[]> {
  const slots = listed.map((target) => target.slot);
  const [reference, ...others] = listed;
  const results: CaseRun[] = [];
  for (const caseName of reference.caseNames) {
    const name = describe.nameOf(caseName);
    const missing = others.find((target) => !target.caseNames.includes(caseName));
    if (missing) {
      // A case added by the change under test, or one library lacks, has nothing to compare with.
      results.push({
        entry: entryOf(name, describe.comparison, slots),
        error: `"${caseName}" does not exist in [${missing.slot.variant}].`,
      });
      continue;
    }

    console.log(chalk.cyan(`\nRunning "${name}" (${describe.file})…`));
    try {
      // eslint-disable-next-line no-await-in-loop
      const rounds = await measureBenchCase(browser, slots, caseName, options);
      // A measurement some iteration did not produce (an interaction whose render count varies,
      // say) cannot be paired round by round, so only those every iteration reported are kept.
      const entry = entryOf(name, describe.comparison, slots, stableMeasurements(rounds));
      results.push({ entry, json: toTachometerJson(entry.variants, entry.measurements, rounds) });
    } catch (error) {
      console.error(chalk.red(`  ${errorMessage(error)}`));
      results.push({
        entry: entryOf(name, describe.comparison, slots),
        error: errorMessage(error),
      });
    }
  }
  return results;
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
): Promise<CaseRun[]> {
  const buildSlots = options.benchRefs.map((ref): PageSlot => ({
    variant: ref.kind === 'worktree' ? 'current' : 'baseline',
    url: benchPageUrl(origin, ref, benchFile).href,
  }));
  // Opened once to learn which cases and comparisons each build defines; every case then measures
  // in fresh pages of its own.
  const listed = await openBenchPages(browser, buildSlots);
  await closeBenchPages(listed);

  const results = await runListedCases(
    browser,
    listed,
    { comparison: 'baseline', nameOf: (caseName) => caseName, file: benchFile.file },
    options,
  );

  const [worktreeRef] = options.benchRefs;
  for (const { name: comparison, variants } of listed[0].comparisons) {
    const variantSlots = variants.map((variant): PageSlot => {
      const url = benchPageUrl(origin, worktreeRef, benchFile);
      url.searchParams.set('compare', comparison);
      url.searchParams.set('variant', variant);
      return { variant, url: url.href };
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      const variantPages = await openBenchPages(browser, variantSlots);
      // eslint-disable-next-line no-await-in-loop
      await closeBenchPages(variantPages);
      results.push(
        // eslint-disable-next-line no-await-in-loop
        ...(await runListedCases(
          browser,
          variantPages,
          {
            comparison: 'variants',
            nameOf: (caseName) => `${comparison} / ${caseName}`,
            file: benchFile.file,
          },
          options,
        )),
      );
    } catch (error) {
      console.error(chalk.red(`  ${errorMessage(error)}`));
      results.push({ entry: entryOf(comparison, 'variants', []), error: errorMessage(error) });
    }
  }
  return results;
}

export async function runInterleaved(options: RunInterleavedOptions): Promise<CaseRun[]> {
  const { chromium } = await import('@playwright/test');
  const [server, browser] = await Promise.all([
    serveDirectory(options.buildsDir),
    chromium.launch({
      executablePath: options.browserBinary,
      headless: true,
      args: [...BENCHMARK_LAUNCH_ARGS, ...(options.asRoot ? ['--no-sandbox'] : [])],
    }),
  ]);

  try {
    const results: CaseRun[] = [];
    // Sequential on purpose: concurrent cases would contend for the same machine.
    for (const benchFile of options.benchFiles) {
      // eslint-disable-next-line no-await-in-loop
      results.push(...(await runBenchFile(browser, server.origin, benchFile, options)));
    }
    return results;
  } finally {
    await browser.close();
    await server.close();
  }
}

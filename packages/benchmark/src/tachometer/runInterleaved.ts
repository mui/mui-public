/* eslint-disable no-console */

import * as path from 'node:path';
import chalk from 'chalk';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS } from '../launchArgs';
import { measurementNameOf } from './discoverCases';
import type { BenchmarkCase, CaseComparison, Leaf } from './discoverCases';
import type { BenchFile } from './benchFiles';
import type { ResolvedRef } from './refs';
import { serveDirectory } from './serveDirectory';
import { shuffledIndices, stableMeasurements, toTachometerJson } from './pairedStats';
import type { Round } from './pairedStats';
import type { TachometerJson } from './summarizeCase';
// Types for `window.benchmarkPage`, which the evaluated functions below call into.
import type {} from '../page/page';

/**
 * The interleaved engine: runs every case in Playwright instead of tachometer, sampling its variants
 * round by round in a shuffled order and comparing them on paired differences.
 *
 * Two kinds of case run here:
 *
 * - A `tachometer.json` case keeps tachometer's page contract. Every sample is a fresh load of the
 *   page, measured by the `performance.measure` entry (or first contentful paint) it names.
 * - A `*.bench.tsx` file runs its `benchmark()` cases in a page that stays open per build: every
 *   sample is one iteration, so module-scope data and the JIT stay warm, and interactions get
 *   trusted input through a CDP session the page is bridged to.
 *
 * Every variant gets a browser context of its own, so no two share a renderer process or a cache.
 */

export interface InterleavedResult {
  entry: BenchmarkCase;
  json?: TachometerJson;
  error?: string;
}

export interface RunInterleavedOptions {
  harnessDir: string;
  /** Where each ref's pages were built, one directory per ref id. */
  buildsDir: string;
  cases: BenchmarkCase[];
  benchFiles: BenchFile[];
  buildFor: (leaf: Leaf) => ResolvedRef;
  /** The builds a benchmark file compares: the working tree first, then the baseline. */
  benchRefs: ResolvedRef[];
  browserBinary: string;
  asRoot: boolean;
  /** Measured rounds per case. Defaults to a `tachometer.json`'s `sampleSize`, else 30. */
  samples?: number;
  /**
   * Discarded rounds before measuring, once per case: default 2 for page loads, 10 for
   * `*.bench.tsx` iterations.
   */
  warmup?: number;
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const DEFAULT_SAMPLES = 30;
const SAMPLE_TIMEOUT_MS = 120_000;

type CdpMethod = Parameters<CDPSession['send']>[0];

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** The Performance entry a tachometer measurement reads, under the name it reports it as. */
interface EntrySpec {
  name: string;
  entryName: string;
}

function entrySpecsOf(node: any): EntrySpec[] {
  return [node.measurement ?? 'callback'].flat().map((measurement: any): EntrySpec => {
    const name = measurementNameOf(measurement, node.measurementExpression);
    if (measurement === 'fcp') {
      return { name, entryName: 'first-contentful-paint' };
    }
    if (typeof measurement === 'object' && measurement.mode === 'performance') {
      return { name, entryName: measurement.entryName };
    }
    throw new Error(
      `The interleaved engine reads Performance entries only; "${name}" in "${node.name}" is a ` +
        `${typeof measurement === 'string' ? measurement : measurement.mode} measurement.`,
    );
  });
}

async function openContext(browser: Browser, viewport = DEFAULT_VIEWPORT) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(SAMPLE_TIMEOUT_MS);
  page.on('pageerror', (error) => console.error(chalk.red(`  page error: ${error.message}`)));
  return { context, page };
}

async function runPageCase(
  browser: Browser,
  origin: string,
  entry: BenchmarkCase,
  options: RunInterleavedOptions,
): Promise<TachometerJson> {
  const nodes: any[] = entry.config.benchmarks;
  const targets = await Promise.all(
    entry.leaves.map(async (leaf, index) => {
      const node = nodes[index];
      const opened = await openContext(browser, node.browser?.windowSize);
      return {
        ...opened,
        url: `${origin}/${options.buildFor(leaf).id}/${leaf.page}${leaf.suffix}`,
        specs: entrySpecsOf(node),
      };
    }),
  );

  try {
    const sample = async ({ page, url, specs }: (typeof targets)[number]) => {
      await page.goto(url);
      const entryNames = specs.map((spec) => spec.entryName);
      await page.waitForFunction(
        (names) => names.every((name) => performance.getEntriesByName(name).length > 0),
        entryNames,
      );
      return page.evaluate(
        (specs) =>
          Object.fromEntries(
            specs.map(({ name, entryName }) => {
              const [performanceEntry] = performance.getEntriesByName(entryName);
              // A paint entry has no duration; tachometer reports its start time instead.
              const value =
                performanceEntry.entryType === 'paint'
                  ? performanceEntry.startTime
                  : performanceEntry.duration;
              return [name, value];
            }),
          ),
        specs,
      );
    };

    const warmup = options.warmup ?? 2;
    const samples = options.samples ?? entry.config.sampleSize ?? DEFAULT_SAMPLES;
    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < warmup + samples; roundIndex += 1) {
      const round: Round = [];
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        round[index] = await sample(targets[index]);
      }
      if (roundIndex >= warmup) {
        rounds.push(round);
      }
    }
    return toTachometerJson(entry.variants, entry.measurements, rounds);
  } finally {
    await Promise.all(targets.map((target) => target.context.close()));
  }
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
  const { context, page } = await openContext(browser);
  const session = await context.newCDPSession(page);
  // Interactions ask for trusted input through this bridge. `send` only accepts the protocol
  // methods Playwright knows by name; the page may ask for any, and Chrome rejects unknown ones.
  await page.exposeBinding(
    'benchmarkCdp',
    (_source, method: string, params?: Record<string, unknown>) =>
      session.send(method as CdpMethod, params),
  );
  await page.goto(slot.url);
  await page.waitForFunction(
    () => window.benchmarkPage !== undefined || window.benchmarkPageError !== undefined,
  );
  const pageError = await page.evaluate(() => window.benchmarkPageError);
  if (pageError !== undefined) {
    await context.close();
    throw new Error(`${slot.url} could not get ready: ${pageError}`);
  }
  const visibility = await page.evaluate(() => document.visibilityState);
  if (visibility !== 'visible') {
    console.warn(chalk.yellow(`  ${slot.url} is ${visibility}; rAF-based waits may stall.`));
  }
  const { caseNames, comparisons } = await page.evaluate(() => ({
    caseNames: window.benchmarkPage!.caseNames(),
    comparisons: window.benchmarkPage!.comparisons(),
  }));
  return { slot, context, page, caseNames, comparisons };
}

/** Runs one iteration; a measured one comes back as its `performance.measure` values by name. */
async function sampleBenchCase(
  target: OpenedPage,
  name: string,
  warmup: boolean,
): Promise<Record<string, number> | undefined> {
  await target.page.evaluate((args) => window.benchmarkPage!.sample(args.name, args), {
    name,
    warmup,
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

/** Opens a page per slot, in a random order so no slot always gets the first process. */
async function openBenchPages(browser: Browser, slots: PageSlot[]): Promise<OpenedPage[]> {
  const opened: OpenedPage[] = [];
  try {
    for (const index of shuffledIndices(slots.length)) {
      // eslint-disable-next-line no-await-in-loop
      opened[index] = await openBenchPage(browser, slots[index]);
    }
  } catch (error) {
    await closeBenchPages(opened.filter(Boolean));
    throw error;
  }
  return opened;
}

async function closeBenchPages(targets: OpenedPage[]): Promise<void> {
  await Promise.all(targets.map((target) => target.context.close()));
}

/**
 * Measures one case: a page per slot stays open for the whole case, so iterations stay warm and
 * module-scope data is built once. Warmup and measured rounds alike run every slot once, in a
 * shuffled order.
 */
async function measureBenchCase(
  browser: Browser,
  slots: PageSlot[],
  name: string,
  options: RunInterleavedOptions,
): Promise<Round[]> {
  const warmup = options.warmup ?? 10;
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

/**
 * Runs every case the first slot defines across all slots, paired by name. The first slot is the
 * reference; a case another slot lacks is reported as an error rather than compared with nothing.
 */
async function runSlotCases(
  browser: Browser,
  slots: PageSlot[],
  listed: OpenedPage[],
  describe: { comparison: CaseComparison; nameOf: (caseName: string) => string; file: string },
  options: RunInterleavedOptions,
): Promise<InterleavedResult[]> {
  const [reference, ...others] = listed;
  const results: InterleavedResult[] = [];
  for (const caseName of reference.caseNames) {
    const name = describe.nameOf(caseName);
    const entry: BenchmarkCase = {
      name,
      configPath: path.join(options.harnessDir, 'src', describe.file),
      config: {},
      comparison: describe.comparison,
      leaves: [],
      variants: slots.map((slot) => `${name} [${slot.variant}]`),
      measurements: [],
    };
    const missing = others.find((target) => !target.caseNames.includes(caseName));
    if (missing) {
      // A case added by the change under test, or one library lacks, has nothing to compare with.
      results.push({ entry, error: `"${caseName}" does not exist in [${missing.slot.variant}].` });
      continue;
    }

    console.log(chalk.cyan(`\nRunning "${name}" (${describe.file})…`));
    try {
      // eslint-disable-next-line no-await-in-loop
      const rounds = await measureBenchCase(browser, slots, caseName, options);
      // A measurement some iteration did not produce (an interaction whose render count varies,
      // say) cannot be paired round by round, so only those every iteration reported are kept.
      entry.measurements = stableMeasurements(rounds);
      results.push({ entry, json: toTachometerJson(entry.variants, entry.measurements, rounds) });
    } catch (error) {
      console.error(chalk.red(`  ${errorMessage(error)}`));
      results.push({ entry, error: errorMessage(error) });
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
): Promise<InterleavedResult[]> {
  const buildSlots = options.benchRefs.map((ref): PageSlot => ({
    variant: ref.kind === 'worktree' ? 'current' : 'baseline',
    url: benchPageUrl(origin, ref, benchFile).href,
  }));
  // Opened once just to learn which cases and comparisons each build defines.
  const listed = await openBenchPages(browser, buildSlots);
  await closeBenchPages(listed);

  const results = await runSlotCases(
    browser,
    buildSlots,
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
        ...(await runSlotCases(
          browser,
          variantSlots,
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
      results.push({
        entry: {
          name: comparison,
          configPath: path.join(options.harnessDir, 'src', benchFile.file),
          config: {},
          comparison: 'variants',
          leaves: [],
          variants: [],
          measurements: [],
        },
        error: errorMessage(error),
      });
    }
  }
  return results;
}

export async function runInterleaved(options: RunInterleavedOptions): Promise<InterleavedResult[]> {
  const { chromium } = await import('@playwright/test');
  const server = await serveDirectory(options.buildsDir);
  const browser = await chromium.launch({
    executablePath: options.browserBinary,
    headless: true,
    args: [...BENCHMARK_LAUNCH_ARGS, ...(options.asRoot ? ['--no-sandbox'] : [])],
  });

  try {
    const results: InterleavedResult[] = [];
    // Sequential on purpose: concurrent cases would contend for the same machine.
    for (const entry of options.cases) {
      console.log(chalk.cyan(`\nRunning "${entry.name}"…`));
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push({ entry, json: await runPageCase(browser, server.origin, entry, options) });
      } catch (error) {
        console.error(chalk.red(`  ${errorMessage(error)}`));
        results.push({ entry, error: errorMessage(error) });
      }
    }
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

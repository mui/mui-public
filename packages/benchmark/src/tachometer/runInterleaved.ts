/* eslint-disable no-console */

import * as path from 'node:path';
import chalk from 'chalk';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS } from '../launchArgs';
import { measurementNameOf } from './discoverCases';
import type { BenchmarkCase, Leaf } from './discoverCases';
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
   * Discarded rounds before measuring: once per case for page loads (default 2), once per epoch
   * for `*.bench.tsx` iterations (default 5).
   */
  warmup?: number;
  /** `*.bench.tsx` only: measured rounds per set of pages before they are reopened. Default 10. */
  epochSize?: number;
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
  const targets = entry.leaves.map((leaf, index) => ({
    url: `${origin}/${options.buildFor(leaf).id}/${leaf.page}${leaf.suffix}`,
    specs: entrySpecsOf(nodes[index]),
  }));
  // A renderer process keeps whatever speed it started with — on a machine with performance and
  // efficiency cores, which kind the scheduler put it on — so two identical pages in two contexts
  // can differ by several percent for as long as those processes live. Every sample is a fresh
  // load anyway, so no variant is tied to a context: each round deals the variants out over the
  // pool anew, and a slow process slows every variant equally often.
  const pool = await Promise.all(
    targets.map(() => openContext(browser, nodes[0]?.browser?.windowSize)),
  );

  try {
    const sample = async (target: (typeof targets)[number], page: Page) => {
      await page.goto(target.url);
      const entryNames = target.specs.map((spec) => spec.entryName);
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
        target.specs,
      );
    };

    const warmup = options.warmup ?? 2;
    const samples = options.samples ?? entry.config.sampleSize ?? DEFAULT_SAMPLES;
    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < warmup + samples; roundIndex += 1) {
      const round: Round = [];
      const dealt = shuffledIndices(pool.length);
      for (const index of shuffledIndices(targets.length)) {
        // eslint-disable-next-line no-await-in-loop
        round[index] = await sample(targets[index], pool[dealt[index]].page);
      }
      if (roundIndex >= warmup) {
        rounds.push(round);
      }
    }
    return toTachometerJson(entry.variants, entry.measurements, rounds);
  } finally {
    await Promise.all(pool.map((opened) => opened.context.close()));
  }
}

interface BenchTarget {
  ref: ResolvedRef;
  context: BrowserContext;
  page: Page;
  caseNames: string[];
}

async function openBenchPage(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  ref: ResolvedRef,
): Promise<BenchTarget> {
  const { context, page } = await openContext(browser);
  const session = await context.newCDPSession(page);
  // Interactions ask for trusted input through this bridge. `send` only accepts the protocol
  // methods Playwright knows by name; the page may ask for any, and Chrome rejects unknown ones.
  await page.exposeBinding(
    'benchmarkCdp',
    (_source, method: string, params?: Record<string, unknown>) =>
      session.send(method as CdpMethod, params),
  );
  await page.goto(`${origin}/${ref.id}/${benchFile.page}`);
  await page.waitForFunction(() => window.benchmarkPage !== undefined);
  const visibility = await page.evaluate(() => document.visibilityState);
  if (visibility !== 'visible') {
    console.warn(
      chalk.yellow(`  ${benchFile.file} [${ref.id}] is ${visibility}; rAF-based waits may stall.`),
    );
  }
  const caseNames = await page.evaluate(() => window.benchmarkPage!.caseNames());
  return { ref, context, page, caseNames };
}

/** Runs one iteration; a measured one comes back as its `performance.measure` values by name. */
async function sampleBenchCase(
  target: BenchTarget,
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

/** Opens a page per build, in a random order so no build always gets the first process. */
async function openBenchPages(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  refs: ResolvedRef[],
): Promise<BenchTarget[]> {
  const targets: BenchTarget[] = [];
  for (const index of shuffledIndices(refs.length)) {
    // eslint-disable-next-line no-await-in-loop
    targets[index] = await openBenchPage(browser, origin, benchFile, refs[index]);
  }
  return targets;
}

async function closeBenchPages(targets: BenchTarget[]): Promise<void> {
  await Promise.all(targets.map((target) => target.context.close()));
}

/**
 * Measures one case in epochs. A page has to stay open for iterations to be warm, which ties each
 * build to one renderer process for as long as it does — and a process keeps whatever speed it
 * started with (a performance or an efficiency core, typically), enough to show up as a difference
 * between identical builds. So every epoch opens fresh pages, warms them up, and measures a slice
 * of the rounds: the process each build lands on is drawn again per epoch instead of once per case.
 */
async function measureBenchCase(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  name: string,
  options: RunInterleavedOptions,
): Promise<Round[]> {
  const warmup = options.warmup ?? 5;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const epochSize = options.epochSize ?? 10;
  const rounds: Round[] = [];
  while (rounds.length < samples) {
    // eslint-disable-next-line no-await-in-loop
    const targets = await openBenchPages(browser, origin, benchFile, options.benchRefs);
    try {
      const measured = Math.min(epochSize, samples - rounds.length);
      for (let roundIndex = 0; roundIndex < warmup + measured; roundIndex += 1) {
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
      // eslint-disable-next-line no-await-in-loop
      await closeBenchPages(targets);
    }
  }
  return rounds;
}

async function runBenchFile(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  options: RunInterleavedOptions,
): Promise<InterleavedResult[]> {
  // Opened once just to learn which cases each build defines.
  const listed = await openBenchPages(browser, origin, benchFile, options.benchRefs);
  await closeBenchPages(listed);
  const [current, ...others] = listed;

  const results: InterleavedResult[] = [];
  for (const name of current.caseNames) {
    const entry: BenchmarkCase = {
      name,
      configPath: path.join(options.harnessDir, 'src', benchFile.file),
      config: {},
      comparison: 'baseline',
      leaves: [],
      variants: listed.map((target) =>
        target.ref.kind === 'worktree' ? `${name} [current]` : `${name} [baseline]`,
      ),
      measurements: [],
    };
    const missing = others.find((target) => !target.caseNames.includes(name));
    if (missing) {
      // A case added by the change under test has nothing to be compared against yet.
      results.push({ entry, error: `"${name}" does not exist in ${missing.ref.id}.` });
      continue;
    }

    console.log(chalk.cyan(`\nRunning "${name}" (${benchFile.file})…`));
    try {
      // eslint-disable-next-line no-await-in-loop
      const rounds = await measureBenchCase(browser, origin, benchFile, name, options);
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

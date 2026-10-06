/* eslint-disable no-console */

import chalk from 'chalk';
import type { Browser, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS, BENCHMARK_VIEWPORT } from '../launchArgs';
import { compareBenchmark, countAlarmedComparisons } from '../runReport';
import type { RunBenchmark, RunMetricDefinition } from '../runReport';
import { differencesResolved, parseHorizons } from '../sampling';
import type { SamplingOptions } from '../sampling';
import type { BenchFile } from './benchFiles';
import type { ResolvedRef } from './refs';
import { serveDirectory } from './serveDirectory';
import type { BenchPage } from '../page/page';

/**
 * Runs the cases of `*.bench.tsx` files in Playwright. A benchmark runs in one tab, which loads the
 * variant to be measured before every sample: every sample is the first iteration of a freshly
 * loaded page, and every variant runs in the same renderer process. Whatever a page or a process
 * holds on to — the JIT tier its code settled into, the heap it grew — then never favours one
 * variant for the whole benchmark, which paired rounds could not tell from a real difference.
 * Interactions get trusted input through a CDP session the tab is bridged to. Variants are sampled
 * once per round in a shuffled order, so the samples are round-aligned and can be compared on paired
 * differences.
 */

export interface RunInterleavedOptions {
  /** Where each ref's pages were built, one directory per ref id. */
  buildsDir: string;
  benchFiles: BenchFile[];
  /** The builds a benchmark file compares: the working tree first, then the baseline. */
  benchRefs: ResolvedRef[];
  browserBinary: string;
  launchArgs: string[];
}

export interface InterleavedResults {
  benchmarks: RunBenchmark[];
  metrics: Record<string, RunMetricDefinition>;
  /** The browser as it reports itself, e.g. `151.0.7922.34`. */
  browserVersion: string;
}

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
type PageListing = Pick<BenchPage, 'cases' | 'comparisons'>;

/**
 * Opens a tab, in a browser context of its own, bridged to a CDP session for trusted input. Closing
 * its context closes it.
 */
async function openBenchTab(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: BENCHMARK_VIEWPORT });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(SAMPLE_TIMEOUT_MS);
    page.on('pageerror', (error) => console.error(chalk.red(`  page error: ${error.message}`)));
    const session = await context.newCDPSession(page);
    // Interactions ask for trusted input through this bridge, which outlives navigations, so it
    // serves every page the tab loads. `send` only accepts the protocol methods Playwright knows by
    // name; the page may ask for any, and Chrome rejects unknown ones.
    await page.exposeBinding(
      'benchmarkCdp',
      (_source, method: string, params?: Record<string, unknown>) =>
        session.send(method as CdpMethod, params),
    );
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Loads a benchmark page into the tab, and waits until it has registered its cases. */
async function loadBenchPage(
  page: Page,
  url: string,
): Promise<PageListing & { visibility: DocumentVisibilityState }> {
  await page.goto(url);
  const ready = await page.waitForFunction(() => {
    if (window.benchmarkPage === undefined) {
      return false;
    }
    return {
      visibility: document.visibilityState,
      cases: window.benchmarkPage.cases,
      comparisons: window.benchmarkPage.comparisons,
    };
  });
  const state = await ready.jsonValue();
  if (!state) {
    throw new Error(`${url} never got ready.`);
  }
  return state;
}

/** Loads pages just to learn what they define. */
async function listBenchPages(browser: Browser, urls: string[]): Promise<PageListing[]> {
  const page = await openBenchTab(browser);
  try {
    const listings: PageListing[] = [];
    for (const url of urls) {
      // eslint-disable-next-line no-await-in-loop
      const { visibility, ...listing } = await loadBenchPage(page, url);
      if (visibility !== 'visible') {
        console.warn(chalk.yellow(`  ${url} is ${visibility}; rAF-based waits may stall.`));
      }
      listings.push(listing);
    }
    return listings;
  } finally {
    await page.context().close();
  }
}

/** Runs one iteration of a case, and returns what it recorded, by series. */
function sampleBenchCase(page: Page, name: string): Promise<Record<string, number>> {
  return page.evaluate((caseName) => window.benchmarkPage!.sample(caseName), name);
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

/** A benchmark as it goes into the report, with the definitions of the metrics it reported. */
interface CaseResult {
  benchmark: RunBenchmark;
  metrics: Record<string, RunMetricDefinition>;
}

type BenchmarkEntry = Pick<RunBenchmark, 'name' | 'file' | 'kind' | 'variants'>;

/** A benchmark to measure: its variants' slots, sampled as its options ask. */
interface MeasuredBenchmark {
  entry: BenchmarkEntry;
  slots: PageSlot[];
  sampling: Required<SamplingOptions>;
}

/** A benchmark to measure, or why it can't be. */
type PlannedBenchmark = MeasuredBenchmark | { entry: BenchmarkEntry; error: string };

/**
 * Measures one benchmark in a tab of its own, loading each slot's page before sampling it. Every
 * round samples every slot once, in a shuffled order. After `sampleSize` rounds it keeps adding
 * rounds while a difference is unresolved against the horizons, until the timeout. A failure is
 * reported as the benchmark's error.
 *
 * Its alarmed comparisons share the run's 5% chance of a false alarm with those of the other
 * `baseline` benchmarks, which haven't been measured yet, or not by this call: each is taken to have
 * one, the common case, and the report counts them exactly afterwards.
 */
async function runBenchmark(
  browser: Browser,
  { entry, slots, sampling }: MeasuredBenchmark,
  otherBaselineBenchmarks: number,
): Promise<CaseResult> {
  console.log(chalk.cyan(`\nRunning "${entry.name}" (${entry.file})…`));
  const { sampleSize, timeout, autoSampleConditions } = sampling;
  const horizons = parseHorizons(autoSampleConditions);
  let opened: Page | undefined;
  try {
    const page = await openBenchTab(browser);
    opened = page;
    let metrics: Record<string, RunMetricDefinition> | undefined;
    const runRound = async (): Promise<Round> => {
      const round: Round = [];
      for (const index of shuffledIndices(slots.length)) {
        // eslint-disable-next-line no-await-in-loop
        await loadBenchPage(page, slots[index].url);
        // eslint-disable-next-line no-await-in-loop
        round[index] = await sampleBenchCase(page, slots[index].caseName);
        if (index === 0 && !metrics) {
          // Read from the reference page: a metric whose config the change under test altered is
          // described the way the change describes it. Its first sample recorded every metric the
          // report keeps, as those are the ones recorded in every round.
          // eslint-disable-next-line no-await-in-loop
          metrics = await page.evaluate(() => window.benchmarkPage!.metricDefinitions());
        }
      }
      return round;
    };

    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < sampleSize; roundIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      rounds.push(await runRound());
    }
    const definitions = metrics ?? {};
    const benchmarkOf = (): RunBenchmark => ({ ...entry, samples: samplesOf(slots, rounds) });

    const isSettled = () => {
      const benchmark = benchmarkOf();
      const familySize =
        countAlarmedComparisons(definitions, [benchmark]) + otherBaselineBenchmarks;
      return differencesResolved(compareBenchmark(definitions, benchmark, familySize), horizons);
    };

    const deadline = Date.now() + timeout * 60_000;
    let resolved = isSettled();
    while (!resolved && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      rounds.push(await runRound());
      resolved = isSettled();
    }
    if (rounds.length > sampleSize || !resolved) {
      console.log(
        chalk.dim(
          `  ${rounds.length} rounds, ${resolved ? 'resolved' : `unresolved after ${timeout} min`}`,
        ),
      );
    }
    return {
      benchmark: { ...benchmarkOf(), sampling: { sampleSize, timedOut: !resolved } },
      metrics: definitions,
    };
  } catch (error) {
    console.error(chalk.red(`  ${errorMessage(error)}`));
    return { benchmark: { ...entry, error: errorMessage(error) }, metrics: {} };
  } finally {
    await opened?.context().close();
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

function benchPageUrl(origin: string, ref: ResolvedRef, benchFile: BenchFile): string {
  return new URL(`${ref.variant}/${benchFile.page}`, `${origin}/`).href;
}

/**
 * Lists a benchmark file's benchmarks: each case on its own across the builds, paired by name with
 * the working tree as the reference, and each `compare()` across its cases on the working tree's
 * build.
 */
async function planBenchFile(
  browser: Browser,
  origin: string,
  benchFile: BenchFile,
  options: RunInterleavedOptions,
): Promise<PlannedBenchmark[]> {
  const urls = options.benchRefs.map((ref) => benchPageUrl(origin, ref, benchFile));
  const variants = options.benchRefs.map((ref) => ref.variant);
  // The other builds only matter for cases measured across them; a file of `compare()`s alone
  // never loads them.
  const [reference] = await listBenchPages(browser, urls.slice(0, 1));
  const others = reference.cases.length > 0 ? await listBenchPages(browser, urls.slice(1)) : [];

  const planned: PlannedBenchmark[] = reference.cases.map(({ name: caseName, sampling }) => {
    const entry: BenchmarkEntry = {
      name: caseName,
      file: benchFile.file,
      kind: 'baseline',
      variants,
    };
    const missing = others.findIndex(
      (listing) => !listing.cases.some((benchCase) => benchCase.name === caseName),
    );
    if (missing !== -1) {
      // A case added by the change under test has nothing to compare with.
      return { entry, error: `"${caseName}" does not exist in [${variants[missing + 1]}].` };
    }
    const slots = urls.map((url, index) => ({ variant: variants[index], url, caseName }));
    return { entry, slots, sampling };
  });

  for (const { name, cases, sampling } of reference.comparisons) {
    const entry: BenchmarkEntry = { name, file: benchFile.file, kind: 'compare', variants: cases };
    const slots = cases.map((caseName) => ({ variant: caseName, url: urls[0], caseName }));
    planned.push({ entry, slots, sampling });
  }
  return planned;
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
    // Every file is listed before any is measured, so each benchmark knows how many others share
    // the run's chance of a false alarm. Nothing is measured yet, so the files list at once.
    const planned = (
      await Promise.all(
        options.benchFiles.map((benchFile) =>
          planBenchFile(browser, server.origin, benchFile, options),
        ),
      )
    ).flat();
    const baselineBenchmarks = planned.filter(
      (plan) => 'slots' in plan && plan.entry.kind === 'baseline',
    ).length;

    const results: CaseResult[] = [];
    // Sequential on purpose: concurrent cases would contend for the same machine.
    for (const plan of planned) {
      if ('error' in plan) {
        results.push({ benchmark: { ...plan.entry, error: plan.error }, metrics: {} });
        continue;
      }
      const others = plan.entry.kind === 'baseline' ? baselineBenchmarks - 1 : 0;
      const startedAt = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const { benchmark, metrics } = await runBenchmark(browser, plan, others);
      results.push({ benchmark: { ...benchmark, durationMs: Date.now() - startedAt }, metrics });
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

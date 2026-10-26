/* eslint-disable no-console */

import { addAbortListener, once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import chalk from 'chalk';
import { chromium } from '@playwright/test';
import sirv from 'sirv';
import type { Browser, CDPSession, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS, BENCHMARK_VIEWPORT } from '../launchArgs';
import { compareBenchmark, formatDuration, formatRoundCount } from '../runReport';
import type { RunBenchmark, RunMetricDefinition } from '../runReport';
import { DEFAULT_SAMPLING, differencesSettled } from '../sampling';
import type { SamplingOptions } from '../sampling';
import type { BenchFile } from './benchFiles';
import type { ResolvedRef } from './refs';
import type { BenchPage } from '../page/page';

/**
 * Runs the cases of `*.bench.tsx` files in Playwright. A file's benchmarks run in one tab, which
 * loads each build's page once per round and samples every benchmark of the file still sampling
 * there, with garbage collected before each sample. A page is reloaded every round, and every
 * variant runs in the same renderer process: whatever a page or a process holds on to — the JIT tier
 * its code settled into, the heap it grew — then never favours one variant for the whole benchmark,
 * which paired rounds could not tell from a real difference. Interactions get trusted input through
 * a CDP session the tab is bridged to. Pages load in a shuffled order every round, and a benchmark's
 * variants on the same page are sampled in a shuffled order too, so the samples are round-aligned and
 * can be compared on paired differences.
 */

export interface RunInterleavedOptions {
  /** Where each ref's pages were built, one directory per ref id. */
  buildsDir: string;
  benchFiles: BenchFile[];
  /** The builds a benchmark file compares: the working tree first, then the baseline. */
  benchRefs: ResolvedRef[];
  launchArgs: string[];
  /** Defaults for the sampling options a benchmark doesn't set itself, from `getSampling`. */
  sampling?: SamplingOptions;
  /** Only run benchmarks whose name matches this, like Vitest's `-t`. */
  testNamePattern?: RegExp;
  /** Stops the run: the browser closes, and the run rejects. */
  signal?: AbortSignal;
  /**
   * Records instead of measuring: every benchmark samples exactly `rounds` rounds, each with a
   * performance trace around its case's run, written to `tracesDir` to open in DevTools. Tracing
   * slows the code it records, so the samples are no measurement.
   */
  trace?: { tracesDir: string; rounds: number };
}

/** A benchmark's trace files, per variant in the order its samples ran. */
export interface BenchmarkTraces extends Pick<RunBenchmark, 'name' | 'file' | 'kind' | 'error'> {
  traces: Record<string, string[]>;
}

export interface InterleavedResults {
  benchmarks: RunBenchmark[];
  metrics: Record<string, RunMetricDefinition>;
  /** The browser as it reports itself, e.g. `151.0.7922.34`. */
  browserVersion: string;
  /** With `trace`, every benchmark's trace files, in the run's order. */
  traces?: BenchmarkTraces[];
}

/** Where a traced run writes its traces, and what it wrote. */
interface Tracer {
  tracesDir: string;
  /** Set before each sample: where its trace goes, and the list it joins once written. */
  next?: { file: string; files: string[] };
  /** Whether a trace is recording, so one a crashed sample left open is closed before the next. */
  recording: boolean;
  /** Per benchmark, its variants' trace files. */
  files: Map<BenchmarkEntry, Record<string, string[]>>;
}

/** Points the tracer at a sample's trace file, before the sample runs. */
async function prepareTrace(
  tracer: Tracer,
  entry: BenchmarkEntry,
  variant: string,
  round: number,
): Promise<void> {
  const dir = path.join(tracer.tracesDir, entry.name.replace(/[^\w.-]+/g, '-'));
  await mkdir(dir, { recursive: true });
  let byVariant = tracer.files.get(entry);
  if (!byVariant) {
    byVariant = {};
    tracer.files.set(entry, byVariant);
  }
  byVariant[variant] ??= [];
  tracer.next = { file: path.join(dir, `${variant}-${round}.json`), files: byVariant[variant] };
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

function shuffled<T>(items: T[]): T[] {
  return shuffledIndices(items.length).map((index) => items[index]);
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
 * Opens a tab, in a browser context of its own, bridged to a CDP session for trusted input, and with
 * a `tracer`, to the browser's tracing, which the page starts and stops around a case's run. Closing
 * its context closes it.
 */
async function openBenchTab(browser: Browser, tracer?: Tracer): Promise<Page> {
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
    if (tracer) {
      await page.exposeBinding('benchmarkTrace', async (_source, action: 'start' | 'stop') => {
        const { next } = tracer;
        if (action === 'start' && next) {
          if (tracer.recording) {
            await browser.stopTracing();
          }
          await browser.startTracing(page, { path: next.file });
          tracer.recording = true;
        } else if (action === 'stop' && tracer.recording) {
          await browser.stopTracing();
          tracer.recording = false;
          next?.files.push(next.file);
          tracer.next = undefined;
        }
      });
    }
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

type BenchmarkEntry = Pick<RunBenchmark, 'name' | 'file' | 'kind' | 'variants' | 'alarms'>;

/** A benchmark to measure: its variants' slots, sampled as its options ask. */
interface MeasuredBenchmark {
  entry: BenchmarkEntry;
  slots: PageSlot[];
  sampling: Required<SamplingOptions>;
}

/** A benchmark to measure, or why it can't be. */
type PlannedBenchmark = MeasuredBenchmark | { entry: BenchmarkEntry; error: string };

/** A benchmark being measured, and how far it got. */
interface Progress {
  plan: MeasuredBenchmark;
  rounds: Round[];
  /** Read from its reference page after its first sample there. */
  metrics?: Record<string, RunMetricDefinition>;
  /** When its time is up: past it, only rounds short of its sample size still run. */
  deadline: number;
  settled: boolean;
  error?: string;
  /** Its samples, plus its share of the page loads they ran in. */
  durationMs: number;
}

function benchmarkOf({ plan, rounds }: Progress): RunBenchmark {
  return { ...plan.entry, samples: samplesOf(plan.slots, rounds) };
}

/** Whether a benchmark still samples: below its sample size, or unsettled before its timeout. */
function isSampling(progress: Progress): boolean {
  if (progress.error !== undefined) {
    return false;
  }
  if (progress.rounds.length < progress.plan.sampling.sampleSize) {
    return true;
  }
  return !progress.settled && Date.now() < progress.deadline;
}

/**
 * Runs one round of a file's benchmarks still sampling: each page they use loads once, in a shuffled
 * order, and samples them there. A benchmark gets the round only if every one of its variants was
 * sampled in it; one whose sample fails stops, with its error, and the page reloads before the next.
 */
async function runFileRound(
  page: Page,
  active: Progress[],
  tracer: Tracer | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const entries = active.map((progress) => ({ progress, round: [] as Round }));
  const urls = [...new Set(active.flatMap(({ plan }) => plan.slots.map((slot) => slot.url)))];
  // Unset after a failed sample, so what the failed case left behind doesn't reach the next one.
  let loadedUrl: string | undefined;
  for (const url of shuffled(urls)) {
    // A benchmark's variants on this page run back to back, in a shuffled order, so none of them
    // always runs on the code the others warmed.
    const onPage = entries.filter(({ progress }) =>
      progress.plan.slots.some((slot) => slot.url === url),
    );
    const samples = onPage.flatMap(({ progress, round }) =>
      shuffled(
        progress.plan.slots.flatMap((slot, index) =>
          slot.url === url ? [{ progress, round, slot, index }] : [],
        ),
      ),
    );
    for (const { progress, round, slot, index } of samples) {
      if (progress.error !== undefined) {
        continue;
      }
      try {
        if (loadedUrl !== url) {
          const loadStartedAt = Date.now();
          // eslint-disable-next-line no-await-in-loop
          await loadBenchPage(page, url);
          loadedUrl = url;
          const loadShare = (Date.now() - loadStartedAt) / onPage.length;
          for (const entry of onPage) {
            entry.progress.durationMs += loadShare;
          }
        }
        if (tracer) {
          // eslint-disable-next-line no-await-in-loop
          await prepareTrace(tracer, progress.plan.entry, slot.variant, progress.rounds.length + 1);
        }
        const startedAt = Date.now();
        // eslint-disable-next-line no-await-in-loop
        round[index] = await sampleBenchCase(page, slot.caseName);
        if (index === 0 && !progress.metrics) {
          // Read from the reference page: a metric whose config the change under test altered is
          // described the way the change describes it. Its first sample recorded every metric the
          // report keeps, as those are the ones recorded in every round.
          // eslint-disable-next-line no-await-in-loop
          progress.metrics = await page.evaluate(() => window.benchmarkPage!.metricDefinitions());
        }
        progress.durationMs += Date.now() - startedAt;
      } catch (error) {
        // A stopped run closes the browser under the sample; that is no failure of the benchmark.
        signal?.throwIfAborted();
        console.error(chalk.red(`  ${progress.plan.entry.name}: ${errorMessage(error)}`));
        progress.error = errorMessage(error);
        loadedUrl = undefined;
      }
    }
  }
  for (const { progress, round } of entries) {
    if (progress.error !== undefined) {
      continue;
    }
    progress.rounds.push(round);
    if (progress.rounds.length >= progress.plan.sampling.sampleSize) {
      progress.settled = differencesSettled(
        compareBenchmark(progress.metrics ?? {}, benchmarkOf(progress)),
      );
    }
  }
}

/**
 * Measures a file's benchmarks in one tab, a round at a time, until none is still sampling, and
 * returns their results in the plans' order. Each keeps its own rounds: it measures `sampleSize` of
 * them, then goes on while a difference that can alarm is unsettled against its band, until
 * `timeout` minutes after its sampling began. A failure is reported as the benchmark's error, as is
 * a plan that couldn't be measured at all.
 */
async function runBenchFile(
  browser: Browser,
  plans: PlannedBenchmark[],
  tracer: Tracer | undefined,
  signal?: AbortSignal,
): Promise<CaseResult[]> {
  const count = `${plans.length} benchmark${plans.length === 1 ? '' : 's'}`;
  console.log(chalk.cyan(`\nRunning ${plans[0].entry.file} (${count})…`));
  const startedAt = Date.now();
  // A plan that couldn't be measured keeps its error; the others get a progress to sample into.
  const tracked = plans.map((plan): Progress | Extract<PlannedBenchmark, { error: string }> =>
    'error' in plan
      ? plan
      : {
          plan,
          rounds: [],
          settled: false,
          // The time limit covers all of its sampling, the rounds of its sample size included.
          deadline: startedAt + plan.sampling.timeout * 60_000,
          durationMs: 0,
        },
  );
  const progresses = tracked.filter((item): item is Progress => 'rounds' in item);
  let opened: Page | undefined;
  try {
    let active = progresses.filter(isSampling);
    const page = active.length > 0 ? await openBenchTab(browser, tracer) : undefined;
    opened = page;
    while (page && active.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await runFileRound(page, active, tracer, signal);
      active = progresses.filter(isSampling);
    }
  } catch (error) {
    signal?.throwIfAborted();
    console.error(chalk.red(`  ${errorMessage(error)}`));
    for (const progress of progresses) {
      progress.error ??= errorMessage(error);
    }
  } finally {
    await opened?.context().close();
  }

  const resultOf = (progress: Progress): CaseResult => {
    const { plan, rounds, settled, error, durationMs } = progress;
    if (error !== undefined) {
      return { benchmark: { ...plan.entry, error, durationMs }, metrics: {} };
    }
    const { sampleSize, timeout } = plan.sampling;
    // A `timeout` of 0 asks for exactly `sampleSize` rounds: stopping there unsettled is the plan.
    const timedOut = !settled && timeout > 0;
    if (rounds.length > sampleSize || timedOut) {
      const outcome = settled ? 'settled' : `timed out after ${timeout} min`;
      console.log(
        chalk.dim(
          `  ${plan.entry.name}: ${formatRoundCount(rounds.length, sampleSize)}, ${outcome}`,
        ),
      );
    }
    return {
      benchmark: {
        ...benchmarkOf(progress),
        sampling: { sampleSize, timedOut },
        durationMs: Math.round(durationMs),
      },
      metrics: progress.metrics ?? {},
    };
  };
  const results = tracked.map((item) =>
    'rounds' in item
      ? resultOf(item)
      : { benchmark: { ...item.entry, error: item.error }, metrics: {} },
  );
  console.log(chalk.dim(`  ${plans[0].entry.file} ran ${formatDuration(Date.now() - startedAt)}`));
  return results;
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

  const planned: PlannedBenchmark[] = reference.cases.map(
    ({ name: caseName, sampling, alarms }) => {
      const entry: BenchmarkEntry = {
        name: caseName,
        file: benchFile.file,
        kind: 'baseline',
        variants,
        ...(alarms ? { alarms } : {}),
      };
      const missing = others.findIndex(
        (listing) => !listing.cases.some((benchCase) => benchCase.name === caseName),
      );
      if (missing !== -1) {
        // A case added by the change under test has nothing to compare with.
        return { entry, error: `"${caseName}" does not exist in [${variants[missing + 1]}].` };
      }
      const slots = urls.map((url, index) => ({ variant: variants[index], url, caseName }));
      return { entry, slots, sampling: samplingOf(sampling, options) };
    },
  );

  for (const { name, cases, sampling } of reference.comparisons) {
    const entry: BenchmarkEntry = { name, file: benchFile.file, kind: 'compare', variants: cases };
    const slots = cases.map((caseName) => ({ variant: caseName, url: urls[0], caseName }));
    planned.push({ entry, slots, sampling: samplingOf(sampling, options) });
  }
  return planned;
}

/**
 * A benchmark's sampling, as in Vitest: what it sets itself, then what the run gives as defaults,
 * then the built-in defaults. Both come from `getSampling`, so they are valid and set no key to
 * undefined. A traced run samples every benchmark for exactly its rounds, whatever it sets.
 */
function samplingOf(
  own: SamplingOptions,
  { sampling: runDefaults = {}, trace }: RunInterleavedOptions,
): Required<SamplingOptions> {
  if (trace) {
    return { sampleSize: trace.rounds, timeout: 0 };
  }
  return { ...DEFAULT_SAMPLING, ...runDefaults, ...own };
}

/** What a run drives: the browser, and every benchmark it was asked for, in order. */
interface PlannedRun {
  browser: Browser;
  planned: PlannedBenchmark[];
}

/**
 * Serves the builds, launches the browser and lists every benchmark the run was asked for, then
 * hands them to `drive`.
 */
async function withPlannedRun<T>(
  options: RunInterleavedOptions,
  drive: (run: PlannedRun) => Promise<T>,
): Promise<T> {
  // In `dev` mode, every page load reads the build from disk and the browser caches nothing
  // (`no-store`).
  const server = http.createServer(sirv(options.buildsDir, { dev: true }));
  await once(server.listen(0, '127.0.0.1'), 'listening');
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      headless: true,
      args: [...BENCHMARK_LAUNCH_ARGS, ...options.launchArgs],
    });
    // Closing the browser ends whatever a page is doing at once, rather than when its sample would.
    const closeOnAbort =
      options.signal && addAbortListener(options.signal, () => void browser.close());
    try {
      options.signal?.throwIfAborted();
      // Every file is listed before any is measured, so a name pattern that matches nothing fails
      // before the run spends anything. Nothing is measured yet, so the files list at once.
      const { testNamePattern } = options;
      const planned = (
        await Promise.all(
          options.benchFiles.map((benchFile) => planBenchFile(browser, origin, benchFile, options)),
        )
      )
        .flat()
        .filter((plan) => !testNamePattern || testNamePattern.test(plan.entry.name));
      if (planned.length === 0) {
        throw new Error(`No benchmark name matches ${testNamePattern}.`);
      }
      return await drive({ browser, planned });
    } finally {
      closeOnAbort?.[Symbol.dispose]();
      await browser.close();
    }
  } finally {
    await server[Symbol.asyncDispose]();
  }
}

export async function runInterleaved(options: RunInterleavedOptions): Promise<InterleavedResults> {
  const tracer: Tracer | undefined = options.trace && {
    tracesDir: options.trace.tracesDir,
    recording: false,
    files: new Map(),
  };
  if (tracer) {
    await rm(tracer.tracesDir, { recursive: true, force: true });
  }
  return withPlannedRun(options, async ({ browser, planned }) => {
    const results: CaseResult[] = [];
    // A file's plans are listed together, so grouping keeps the run's order. Sequential on purpose:
    // concurrent files would contend for the same machine, and a browser traces one tab at a time.
    for (const plans of Map.groupBy(planned, (plan) => plan.entry.file).values()) {
      // eslint-disable-next-line no-await-in-loop
      results.push(...(await runBenchFile(browser, plans, tracer, options.signal)));
    }
    const benchmarks = results.map((result) => result.benchmark);
    return {
      benchmarks,
      metrics: Object.assign({}, ...results.map((result) => result.metrics)),
      browserVersion: browser.version(),
      ...(tracer && {
        traces: planned.map(({ entry }, index) => ({
          name: entry.name,
          file: entry.file,
          kind: entry.kind,
          traces: tracer.files.get(entry) ?? {},
          ...(benchmarks[index].error === undefined ? {} : { error: benchmarks[index].error }),
        })),
      }),
    };
  });
}

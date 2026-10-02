/* eslint-disable no-console */

import chalk from 'chalk';
import type { Browser, BrowserContext, CDPSession, Frame, Page } from '@playwright/test';
import { BENCHMARK_LAUNCH_ARGS, BENCHMARK_VIEWPORT } from '../launchArgs';
import { compareBenchmark } from '../runReport';
import type { RunBenchmark, RunMetricDefinition } from '../runReport';
import { differencesResolved, parseHorizons } from '../sampling';
import type { SamplingOptions } from '../sampling';
import type { BenchFile } from './benchFiles';
import type { ResolvedRef } from './refs';
import { serveDirectory } from './serveDirectory';
import type { BenchPage } from '../page/page';

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
  /** Discarded rounds before measuring, once per benchmark. */
  warmup: number;
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

interface OpenedPage {
  context: BrowserContext;
  page: Page;
  listing: PageListing;
}

/** Bridges a page's trusted-input requests to a CDP session on it. */
async function bridgeCdp(context: BrowserContext, page: Page): Promise<void> {
  const session = await context.newCDPSession(page);
  // Interactions ask for trusted input through this bridge. `send` only accepts the protocol
  // methods Playwright knows by name; the page may ask for any, and Chrome rejects unknown ones.
  await page.exposeBinding(
    'benchmarkCdp',
    (_source, method: string, params?: Record<string, unknown>) =>
      session.send(method as CdpMethod, params),
  );
}

function watchErrors(page: Page): void {
  page.setDefaultTimeout(SAMPLE_TIMEOUT_MS);
  page.on('pageerror', (error) => console.error(chalk.red(`  page error: ${error.message}`)));
}

/** Loads a benchmark page into `page` and waits until it has registered its cases. */
async function loadBenchPage(page: Page | Frame, url?: string): Promise<PageListing> {
  if (url) {
    await page.goto(url);
  }
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
    throw new Error(`${page.url()} never got ready.`);
  }
  if (state.visibility !== 'visible') {
    console.warn(
      chalk.yellow(`  ${page.url()} is ${state.visibility}; rAF-based waits may stall.`),
    );
  }
  return state;
}

async function openBenchPage(browser: Browser, url: string): Promise<OpenedPage> {
  const context = await browser.newContext({ viewport: BENCHMARK_VIEWPORT });
  try {
    const page = await context.newPage();
    watchErrors(page);
    await bridgeCdp(context, page);
    return { context, page, listing: await loadBenchPage(page, url) };
  } catch (error) {
    await context.close();
    throw error;
  }
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

/** Runs one iteration of a case, and returns what it recorded, by series. */
function sampleBenchCase(
  target: Page | Frame,
  name: string,
  collectGarbage = true,
): Promise<Record<string, number>> {
  return target.evaluate(
    ([caseName, collect]) => window.benchmarkPage!.sample(caseName, { collectGarbage: collect }),
    [name, collectGarbage] as const,
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

/** A benchmark as it goes into the report, with the definitions of the metrics it reported. */
interface CaseResult {
  benchmark: RunBenchmark;
  metrics: Record<string, RunMetricDefinition>;
}

type BenchmarkEntry = Pick<RunBenchmark, 'name' | 'file' | 'kind' | 'variants'>;

/** How the variants of a benchmark are isolated from each other. EXPERIMENT. */
type Isolation = 'pages' | 'iframes' | 'fresh' | 'recycle';

const ISOLATION: Isolation = (process.env.BENCHMARK_ISOLATION as Isolation | undefined) ?? 'pages';

/** Runs the slots of one benchmark, one sample at a time. */
interface Sampler {
  /** Whether warmup rounds are worth running: not when every sample gets a fresh page. */
  warmup: boolean;
  beginRound?: () => Promise<void>;
  sample: (index: number) => Promise<Record<string, number>>;
  endRound?: () => Promise<void>;
  metricDefinitions: () => Promise<Record<string, RunMetricDefinition>>;
  close: () => Promise<void>;
}

/** Every slot in a page of its own, open for the whole benchmark. */
async function openPagesSampler(browser: Browser, slots: PageSlot[]): Promise<Sampler> {
  const targets = await openBenchPages(
    browser,
    slots.map((slot) => slot.url),
  );
  return {
    warmup: true,
    sample: (index) => sampleBenchCase(targets[index].page, slots[index].caseName),
    metricDefinitions: () =>
      targets[0].page.evaluate(() => window.benchmarkPage!.metricDefinitions()),
    close: () => closeBenchPages(targets),
  };
}

function iframeHostHtml(slots: PageSlot[]): string {
  const { width, height } = BENCHMARK_VIEWPORT;
  const frames = slots
    .map(
      (slot, index) =>
        `<iframe name="slot-${index}" src="${slot.url}" style="left: ${index * width}px"></iframe>`,
    )
    .join('');
  return `<!doctype html><html><head><style>
html, body { margin: 0; overflow: hidden; }
iframe { position: absolute; top: 0; width: ${width}px; height: ${height}px; border: 0; }
</style></head><body>${frames}</body></html>`;
}

/**
 * Every slot in an iframe of one page, all same-origin, so they share a renderer process, its main
 * thread and its heap. The frames sit side by side in a viewport as wide as all of them, each the
 * size a page would be, so every frame is always on screen and nothing changes between samples. A
 * frame's trusted input is shifted by the frame's offset, so it lands in that frame.
 */
async function openIframesSampler(browser: Browser, slots: PageSlot[]): Promise<Sampler> {
  const context = await browser.newContext({
    viewport: {
      width: BENCHMARK_VIEWPORT.width * slots.length,
      height: BENCHMARK_VIEWPORT.height,
    },
  });
  try {
    const page = await context.newPage();
    watchErrors(page);
    const session = await context.newCDPSession(page);
    await page.exposeBinding(
      'benchmarkCdp',
      ({ frame }, method: string, params?: Record<string, unknown>) => {
        const index = Number(frame.name().slice('slot-'.length));
        const offset = Number.isInteger(index) ? index * BENCHMARK_VIEWPORT.width : 0;
        const shifted =
          typeof params?.x === 'number' ? { ...params, x: params.x + offset } : params;
        return session.send(method as CdpMethod, shifted);
      },
    );
    const hostUrl = new URL('/__benchmark-host.html', slots[0].url).href;
    const html = iframeHostHtml(slots);
    await page.route(hostUrl, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(hostUrl);
    const frames = slots.map((_, index) => {
      const frame = page.frame({ name: `slot-${index}` });
      if (!frame) {
        throw new Error(`No frame for slot ${index}.`);
      }
      return frame;
    });
    await Promise.all(frames.map((frame) => loadBenchPage(frame)));
    return {
      warmup: true,
      sample: (index) => sampleBenchCase(frames[index], slots[index].caseName),
      metricDefinitions: () => frames[0].evaluate(() => window.benchmarkPage!.metricDefinitions()),
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Every sample in a page of its own: each round loads one fresh page per slot — all at once, before
 * anything is measured — samples each once, cold, and closes them. Nothing carries over between
 * samples, so neither warmup nor a GC between them has anything to do. A slot keeps one context for
 * the whole benchmark, so its HTTP cache stays warm, and holds one page at a time: pages sharing a
 * context are tabs of one window, and only the last one opened renders at full priority.
 */
async function openFreshSampler(browser: Browser, slots: PageSlot[]): Promise<Sampler> {
  const contexts = await Promise.all(
    slots.map(() => browser.newContext({ viewport: BENCHMARK_VIEWPORT })),
  );
  let pages: Page[] = [];
  let definitions: Record<string, RunMetricDefinition> = {};
  const closeRound = async () => {
    const closing = pages;
    pages = [];
    await Promise.all(closing.map((page) => page.close()));
  };
  return {
    warmup: false,
    async beginRound() {
      pages = await Promise.all(
        slots.map(async (slot, index) => {
          const page = await contexts[index].newPage();
          watchErrors(page);
          await bridgeCdp(contexts[index], page);
          await loadBenchPage(page, slot.url);
          return page;
        }),
      );
    },
    sample: (index) => sampleBenchCase(pages[index], slots[index].caseName, false),
    async endRound() {
      definitions = await pages[0].evaluate(() => window.benchmarkPage!.metricDefinitions());
      await closeRound();
    },
    metricDefinitions: async () => definitions,
    async close() {
      await closeRound();
      await Promise.all(contexts.map((context) => context.close()));
    },
  };
}

/**
 * One tab for the whole benchmark, which loads the variant to be measured before every sample: each
 * sample is a cold first iteration, as in the `fresh` mode, but every variant runs in the same
 * renderer process, so whatever belongs to the process affects them all alike.
 */
async function openRecycleSampler(browser: Browser, slots: PageSlot[]): Promise<Sampler> {
  const context = await browser.newContext({ viewport: BENCHMARK_VIEWPORT });
  try {
    const page = await context.newPage();
    watchErrors(page);
    // The binding survives navigations, so one bridge serves every load.
    await bridgeCdp(context, page);
    let definitions: Record<string, RunMetricDefinition> = {};
    return {
      warmup: false,
      async sample(index) {
        await loadBenchPage(page, slots[index].url);
        const values = await sampleBenchCase(page, slots[index].caseName, false);
        if (index === 0) {
          definitions = await page.evaluate(() => window.benchmarkPage!.metricDefinitions());
        }
        return values;
      },
      metricDefinitions: async () => definitions,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function openSampler(browser: Browser, slots: PageSlot[]): Promise<Sampler> {
  switch (ISOLATION) {
    case 'iframes':
      return openIframesSampler(browser, slots);
    case 'recycle':
      return openRecycleSampler(browser, slots);
    case 'fresh':
      return openFreshSampler(browser, slots);
    default:
      return openPagesSampler(browser, slots);
  }
}

/**
 * Measures one benchmark. Warmup and measured rounds alike run every slot once, in a shuffled
 * order. After `sampleSize` rounds it keeps adding rounds while a difference is unresolved against
 * the horizons, until the timeout. A failure is reported as the benchmark's error.
 */
async function runBenchmark(
  browser: Browser,
  entry: BenchmarkEntry,
  slots: PageSlot[],
  sampling: Required<SamplingOptions>,
  options: RunInterleavedOptions,
): Promise<CaseResult> {
  console.log(chalk.cyan(`\nRunning "${entry.name}" (${entry.file}) [${ISOLATION}]…`));
  const startedAt = Date.now();
  const { sampleSize, timeout, autoSampleConditions } = sampling;
  const horizons = parseHorizons(autoSampleConditions);
  let sampler: Sampler | undefined;
  const runRound = async (): Promise<Round> => {
    await sampler!.beginRound?.();
    const round: Round = [];
    for (const index of shuffledIndices(slots.length)) {
      // eslint-disable-next-line no-await-in-loop
      round[index] = await sampler!.sample(index);
    }
    await sampler!.endRound?.();
    return round;
  };
  try {
    sampler = await openSampler(browser, slots);
    const warmupRounds = sampler.warmup ? options.warmup : 0;
    for (let roundIndex = 0; roundIndex < warmupRounds; roundIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      await runRound();
    }
    const rounds: Round[] = [];
    for (let roundIndex = 0; roundIndex < sampleSize; roundIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      rounds.push(await runRound());
    }
    // Read from the reference page: a metric whose config the change under test altered is
    // described the way the change describes it. Every metric has been recorded by now.
    const metrics = await sampler.metricDefinitions();
    const benchmarkOf = (): RunBenchmark => ({ ...entry, samples: samplesOf(slots, rounds) });

    const isSettled = () => differencesResolved(compareBenchmark(metrics, benchmarkOf()), horizons);

    const deadline = Date.now() + timeout * 60_000;
    let resolved = isSettled();
    while (!resolved && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      rounds.push(await runRound());
      resolved = isSettled();
    }
    console.log(
      chalk.dim(
        `  ${rounds.length} rounds, ${resolved ? 'resolved' : `unresolved after ${timeout} min`}, ` +
          `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      ),
    );
    return {
      benchmark: { ...benchmarkOf(), sampling: { sampleSize, timedOut: !resolved } },
      metrics,
    };
  } catch (error) {
    console.error(chalk.red(`  ${errorMessage(error)}`));
    return { benchmark: { ...entry, error: errorMessage(error) }, metrics: {} };
  } finally {
    await sampler?.close();
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
  const variants = options.benchRefs.map((ref) => ref.variant);
  // The other builds only matter for cases measured across them; a file of `compare()`s alone
  // never loads them.
  const [reference] = await listBenchPages(browser, urls.slice(0, 1));
  const others = reference.cases.length > 0 ? await listBenchPages(browser, urls.slice(1)) : [];

  const results: CaseResult[] = [];
  for (const { name: caseName, sampling } of reference.cases) {
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
    results.push(await runBenchmark(browser, entry, slots, sampling, options));
  }

  for (const { name, cases, sampling } of reference.comparisons) {
    const entry: BenchmarkEntry = { name, file: benchFile.file, kind: 'compare', variants: cases };
    const slots = cases.map((caseName) => ({ variant: caseName, url: urls[0], caseName }));
    // eslint-disable-next-line no-await-in-loop
    results.push(await runBenchmark(browser, entry, slots, sampling, options));
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

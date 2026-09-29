import { createInput } from '../input';
import type { BenchmarkInput } from '../input';
import type { VariantLoader } from '../caseRuntime';
import { seriesName, setMetricRecorder } from '../metricCore';
import type { MetricDefinition } from '../types';

// The page runtime `benchmark run` measures. `benchmark()` registers a case, and the runner calls
// `window.benchmarkPage.sample()` to run one iteration of it at a time. What a case measures is
// whatever it records through a `Metric`; every recorded value leaves the page as a
// `performance.measure` entry, so it also shows up in a DevTools trace.

/** What a case's `run` is handed on every iteration. */
export interface BenchmarkContext {
  /** Trusted input — scroll, pinch, tap — dispatched by the browser rather than from script. */
  input: BenchmarkInput;
}

/**
 * One iteration of a case. It records its results through `Metric`s — `ScalarMetric`,
 * `DiscreteMetric` — and must record at least one value.
 */
export type BenchmarkRun = (context: BenchmarkContext) => Promise<void> | void;

/** The file's own `benchmark()` cases. */
const fileCases = new Map<string, BenchmarkRun>();
// Where `benchmark()` registers: the file's own cases, except while a `compare()` variant module is
// being loaded, whose cases belong to that variant.
let registering = fileCases;
// The cases this page runs: the file's own, or the variant the url selects.
let pageCases = fileCases;

/**
 * Registers a benchmark case. The runner calls `run` once per sample, warmup included, and decides
 * how many samples to take.
 */
export function benchmark(name: string, run: BenchmarkRun): void {
  if (registering.has(name)) {
    throw new Error(`Two benchmarks share the name "${name}". Benchmark names must be unique.`);
  }
  registering.set(name, run);
}

const comparisons = new Map<string, Record<string, VariantLoader>>();

/**
 * Compares implementations against each other — one library against another, say. Each variant is
 * a module of ordinary `benchmark()` calls; cases are paired across variants by name, and the first
 * variant is the reference. A variant's page loads only its own module, so no variant's code,
 * styles or module state is present while another is measured.
 */
export function compare(name: string, variants: Record<string, VariantLoader>): void {
  if (comparisons.has(name)) {
    throw new Error(`Two comparisons share the name "${name}". Comparison names must be unique.`);
  }
  if (Object.keys(variants).length < 2) {
    throw new Error(`Comparison "${name}" needs at least two variants.`);
  }
  comparisons.set(name, variants);
}

/** Loads the variant `?compare=<name>&variant=<key>` selects, if any, and runs its cases instead. */
async function selectVariant(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const comparison = params.get('compare');
  const variant = params.get('variant');
  if (comparison === null || variant === null) {
    return;
  }
  const load = comparisons.get(comparison)?.[variant];
  if (!load) {
    throw new Error(`No variant "${variant}" in comparison "${comparison}".`);
  }
  const variantCases = new Map<string, BenchmarkRun>();
  registering = variantCases;
  try {
    await load();
  } finally {
    registering = fileCases;
  }
  pageCases = variantCases;
}

interface RecordedValue {
  name: string;
  value: number;
}

// Values recorded during a measured sample. `null` outside one (module scope, warmup), where
// recorded values are dropped.
let sampleValues: RecordedValue[] | null = null;

// Every metric recorded so far, by name, as the report describes it.
const metricDefinitions = new Map<string, MetricDefinition>();

setMetricRecorder((metric, value, options) => {
  if (!metricDefinitions.has(metric.name)) {
    metricDefinitions.set(metric.name, {
      kind: metric.kind,
      format: metric.config.format,
      alarm: metric.config.alarm,
    });
  }
  sampleValues?.push({ name: seriesName(metric.name, options?.id), value });
});

export interface BenchPage {
  caseNames: () => string[];
  /** The file's `compare()` calls, with their variant keys in order. */
  comparisons: () => Array<{ name: string; variants: string[] }>;
  /** Every metric recorded so far, by name. */
  metricDefinitions: () => Record<string, MetricDefinition>;
  /**
   * Runs one iteration of a case. A measured sample leaves its results as `performance.measure`
   * entries for the runner to collect; a warmup sample leaves none.
   */
  sample: (name: string, options: { warmup: boolean }) => Promise<void>;
}

declare global {
  interface Window {
    /** Set by `markPageReady()` once the benchmark file has registered its cases. */
    benchmarkPage?: BenchPage;
    /** Set instead of `benchmarkPage` when the page could not get ready. */
    benchmarkPageError?: string;
    /** Exposed by the runner: forwards a CDP command to this page's session. */
    benchmarkCdp?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  }
}

const input = createInput((method, params) => {
  if (!window.benchmarkCdp) {
    throw new Error('No CDP bridge: the runner must expose `benchmarkCdp` on this page.');
  }
  return window.benchmarkCdp(method, params);
});

async function sample(name: string, { warmup }: { warmup: boolean }): Promise<void> {
  const run = pageCases.get(name);
  if (!run) {
    throw new Error(`No benchmark named "${name}". Known: ${[...pageCases.keys()].join(', ')}`);
  }
  performance.clearMarks();
  performance.clearMeasures();

  const values: RecordedValue[] = [];
  // Recorded even during warmup, so a case that records nothing fails before a single sample is
  // measured; only a measured sample's values leave the page.
  sampleValues = values;
  try {
    await run({ input });
  } finally {
    sampleValues = null;
  }

  if (values.length === 0) {
    throw new Error(
      `Benchmark "${name}" recorded no value. Record its results through a ScalarMetric or DiscreteMetric.`,
    );
  }
  if (warmup) {
    return;
  }
  // The runner collects measures by name, and a value isn't necessarily a duration, so it travels
  // in `detail`.
  const now = performance.now();
  for (const { name: series, value } of values) {
    performance.measure(series, { start: now, duration: 0, detail: { value } });
  }
}

/**
 * Called by the generated page entry after it has imported every benchmark file. The runner waits
 * for `window.benchmarkPage`, or reads `window.benchmarkPageError` when getting ready failed.
 */
export async function markPageReady(): Promise<void> {
  try {
    await selectVariant();
  } catch (error) {
    window.benchmarkPageError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    return;
  }
  window.benchmarkPage = {
    caseNames: () => [...pageCases.keys()],
    comparisons: () =>
      [...comparisons].map(([name, variants]) => ({ name, variants: Object.keys(variants) })),
    metricDefinitions: () => Object.fromEntries(metricDefinitions),
    sample,
  };
}

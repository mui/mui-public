import { createInput } from '../input';
import type { BenchmarkInput } from '../input';
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

/** A registered case, as `benchmark()` returns it for `compare()` to group. */
export interface BenchmarkCase {
  readonly name: string;
}

/** Every case the file registered, by name. */
const cases = new Map<string, BenchmarkRun>();

/**
 * Registers a benchmark case. The runner calls `run` once per sample, warmup included, and decides
 * how many samples to take. A case on its own is measured across the builds; one passed to
 * `compare()` is measured against the other cases there instead.
 */
export function benchmark(name: string, run: BenchmarkRun): BenchmarkCase {
  if (cases.has(name)) {
    throw new Error(`Two benchmarks share the name "${name}". Benchmark names must be unique.`);
  }
  cases.set(name, run);
  return { name };
}

/** Each `compare()`'s cases, by name, the reference first. */
const comparisons = new Map<string, string[]>();

/**
 * Compares cases with each other — one library's implementation against another's, say — on the
 * working tree's build, rather than each against its baseline. The first case is the reference.
 *
 * Every case is measured in a page of its own, but a page loads the whole file. Import what only one
 * case needs inside that case (`await import()` resolves during warmup) to keep it out of the others'
 * pages.
 */
export function compare(name: string, compared: BenchmarkCase[]): void {
  if (comparisons.has(name)) {
    throw new Error(`Two comparisons share the name "${name}". Comparison names must be unique.`);
  }
  if (compared.length < 2) {
    throw new Error(`Comparison "${name}" needs at least two cases.`);
  }
  for (const benchCase of compared) {
    const owner = [...comparisons].find(([, names]) => names.includes(benchCase.name));
    if (owner) {
      throw new Error(`"${benchCase.name}" is already compared in "${owner[0]}".`);
    }
  }
  comparisons.set(
    name,
    compared.map((benchCase) => benchCase.name),
  );
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
  /** The cases measured across the builds: every case no `compare()` took. */
  caseNames: () => string[];
  /** The file's `compare()` calls, with their cases' names in order. */
  comparisons: () => Array<{ name: string; cases: string[] }>;
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
  const run = cases.get(name);
  if (!run) {
    throw new Error(`No benchmark named "${name}". Known: ${[...cases.keys()].join(', ')}`);
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
 * Called by the generated page entry after it has imported the benchmark file. The runner waits for
 * `window.benchmarkPage`.
 */
export function markPageReady(): void {
  const compared = new Set([...comparisons.values()].flat());
  window.benchmarkPage = {
    caseNames: () => [...cases.keys()].filter((name) => !compared.has(name)),
    comparisons: () =>
      [...comparisons].map(([name, comparedNames]) => ({ name, cases: comparedNames })),
    metricDefinitions: () => Object.fromEntries(metricDefinitions),
    sample,
  };
}

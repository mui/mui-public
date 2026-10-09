import { collectGarbage } from '../gc';
import { createInput } from '../input';
import type { BenchmarkCdp, BenchmarkInput, CdpSend } from '../input';
import { seriesName, setMetricRecorder } from '../metricCore';
import { pickSampling, resolveSampling } from '../sampling';
import type { SamplingOptions } from '../sampling';
import type { MetricDefinition } from '../types';
import type { RunMetricAlarm } from '../runReport/schema';

// The page runtime the `benchmark` CLI measures. `benchmark()` registers a case, and the runner calls
// `window.benchmarkPage.sample()` to run one iteration of it at a time. What a case measures is
// whatever it records through a `Metric`; every recorded value leaves the page as a
// `performance.measure` entry, so it also shows up in a DevTools trace.

/** What a case's `run` is handed on every iteration. */
export interface BenchmarkContext {
  /** Trusted input — scroll, pinch, tap — dispatched by the browser rather than from script. */
  input: BenchmarkInput;
  /** The DevTools Protocol, for what the case sets up or reads from the browser itself. */
  cdp: BenchmarkCdp;
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

export interface BenchmarkCaseOptions extends SamplingOptions {
  /**
   * This benchmark's own alarms, by metric name, in place of the metric's: its fields override the
   * metric's alarm — a lower `error` band for a benchmark that matters more, a higher one for one
   * that matters less — and `false` means the metric never alarms here. A `name#id` sub-series
   * follows its base metric.
   */
  alarms?: Record<string, RunMetricAlarm | false>;
}

/** Every case the file registered, by name, with the sampling and alarms it set. */
const cases = new Map<
  string,
  { run: BenchmarkRun; sampling: SamplingOptions; alarms?: BenchmarkCaseOptions['alarms'] }
>();

/**
 * Registers a benchmark case. The runner calls `run` once per sample, each time in a freshly loaded
 * page, for as many rounds as `options` asks. A case on its own is measured across the builds; one
 * passed to `compare()` is measured against the other cases there instead, sampled as the
 * `compare()` asks, and never alarms.
 */
export function benchmark(
  name: string,
  run: BenchmarkRun,
  options: BenchmarkCaseOptions = {},
): BenchmarkCase {
  if (cases.has(name)) {
    throw new Error(`Two benchmarks share the name "${name}". Benchmark names must be unique.`);
  }
  // Resolved here only to reject invalid options where they were written.
  resolveSampling(options);
  cases.set(name, { run, sampling: pickSampling(options), alarms: options.alarms });
  return { name };
}

/** Each `compare()`, with its cases' names, the reference first. */
const comparisons: Array<{
  name: string;
  cases: string[];
  sampling: SamplingOptions;
}> = [];

/**
 * Compares cases with each other — one library's implementation against another's, say — on the
 * working tree's build, rather than each against its baseline. The first case is the reference.
 *
 * Every sample loads the whole file in a fresh page. Import what only one case needs inside that
 * case, before the part it times, to keep it out of the others' samples.
 */
export function compare(
  name: string,
  compared: BenchmarkCase[],
  sampling: SamplingOptions = {},
): void {
  if (comparisons.some((comparison) => comparison.name === name)) {
    throw new Error(`Two comparisons share the name "${name}". Comparison names must be unique.`);
  }
  if (compared.length < 2) {
    throw new Error(`Comparison "${name}" needs at least two cases.`);
  }
  // Resolved here only to reject invalid options where they were written.
  resolveSampling(sampling);
  for (const benchCase of compared) {
    const own = cases.get(benchCase.name);
    if (own && Object.keys(own.sampling).length > 0) {
      throw new Error(
        `"${benchCase.name}" sets its own sampling, but a compared case is sampled as its ` +
          `compare() asks: pass the options to compare("${name}", …) instead.`,
      );
    }
    if (own?.alarms) {
      throw new Error(
        `"${benchCase.name}" sets its own alarms, but a compared case never alarms: its ` +
          `variants differ on purpose.`,
      );
    }
    const owner = comparisons.find((comparison) => comparison.cases.includes(benchCase.name));
    if (owner) {
      throw new Error(`"${benchCase.name}" is already compared in "${owner.name}".`);
    }
  }
  comparisons.push({
    name,
    cases: compared.map((benchCase) => benchCase.name),
    sampling: pickSampling(sampling),
  });
}

// Values recorded during a sample, summed per series: a metric recorded more than once in an
// iteration counts its total for that iteration. `null` outside a sample (module scope), where
// recorded values are dropped.
let sampleValues: Map<string, number> | null = null;

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
  if (sampleValues) {
    const series = seriesName(metric.name, options?.id);
    sampleValues.set(series, (sampleValues.get(series) ?? 0) + value);
  }
});

export interface BenchPage {
  /** The cases measured across the builds: every case no `compare()` took. */
  cases: Array<{
    name: string;
    sampling: SamplingOptions;
    alarms?: BenchmarkCaseOptions['alarms'];
  }>;
  /** The file's `compare()` calls, with their cases' names in order. */
  comparisons: Array<{ name: string; cases: string[]; sampling: SamplingOptions }>;
  /** Every metric recorded so far, by name. */
  metricDefinitions: () => Record<string, MetricDefinition>;
  /** Runs one iteration of a case, and returns what it recorded, by series. */
  sample: (name: string) => Promise<Record<string, number>>;
}

declare global {
  interface Window {
    /** Set by `markPageReady()` once the benchmark file has registered its cases. */
    benchmarkPage?: BenchPage;
    /** Exposed by the runner: forwards a CDP command to this page's session. */
    benchmarkCdp?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  }
}

const send: CdpSend = (method, params) => {
  if (!window.benchmarkCdp) {
    throw new Error('No CDP bridge: the runner must expose `benchmarkCdp` on this page.');
  }
  return window.benchmarkCdp(method, params);
};
const input = createInput(send);
const cdp: BenchmarkCdp = { send };

async function sample(name: string): Promise<Record<string, number>> {
  const run = cases.get(name)?.run;
  if (!run) {
    throw new Error(`No benchmark named "${name}". Known: ${[...cases.keys()].join(', ')}`);
  }
  await collectGarbage();
  performance.clearMarks();
  performance.clearMeasures();

  const values = new Map<string, number>();
  sampleValues = values;
  try {
    await run({ input, cdp });
  } finally {
    sampleValues = null;
  }

  if (values.size === 0) {
    throw new Error(
      `Benchmark "${name}" recorded no value. Record its results through a ScalarMetric or DiscreteMetric.`,
    );
  }
  // Also left as `performance.measure` entries, so a sample shows up in a DevTools trace.
  const now = performance.now();
  for (const [series, value] of values) {
    performance.measure(series, { start: now, duration: 0, detail: { value } });
  }
  return Object.fromEntries(values);
}

/**
 * Called by the generated page entry after it has imported the benchmark file. The runner waits for
 * `window.benchmarkPage`.
 */
export function markPageReady(): void {
  window.benchmarkPage = {
    cases: [...cases]
      .filter(([name]) => !comparisons.some((comparison) => comparison.cases.includes(name)))
      .map(([name, { sampling, alarms }]) => ({ name, sampling, ...(alarms ? { alarms } : {}) })),
    comparisons,
    metricDefinitions: () => Object.fromEntries(metricDefinitions),
    sample,
  };
}

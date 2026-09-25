import type * as React from 'react';
import { createInput } from '../input';
import { measureIteration } from '../caseRuntime';
import type { BenchmarkInteraction, CaseOptions } from '../caseRuntime';
import { setMetricRecorder } from '../metricCore';

// What `@mui/internal-benchmark` resolves to when benchmark files are built into an A/B page
// instead of run by Vitest. Same authoring API, different driver: `benchmark()` registers a case,
// and the runner calls `window.benchmarkPage.sample()` to run one iteration of it at a time. Every result
// leaves the page as a `performance.measure` entry, the same contract plain tachometer pages use.

export type { RenderEvent, IterationData, InteractionContext } from '../types';
export type {
  MetricKind,
  MetricDirection,
  MetricAlarm,
  MetricConfig,
  MetricDefinition,
} from '../types';
export type { BenchmarkInput } from '../input';
export type { BenchmarkInteraction } from '../caseRuntime';
export { ElementTiming } from '../ElementTiming';
export { Metric, type MetricRecordOptions } from '../metricCore';
export { ScalarMetric } from '../ScalarMetric';
export { DiscreteMetric } from '../DiscreteMetric';

/** `benchmark()`'s options. The iteration counts are ignored here: the runner decides them. */
export interface BenchmarkOptions extends CaseOptions {
  runs?: number;
  warmupRuns?: number;
}

interface PageCase {
  renderFn: () => React.ReactElement;
  interaction: BenchmarkInteraction | undefined;
  options: CaseOptions | undefined;
}

/** The file's own `benchmark()` cases. */
const fileCases = new Map<string, PageCase>();
// Where `benchmark()` registers: the file's own cases, except while a `compare()` variant module is
// being loaded, whose cases belong to that variant.
let registering = fileCases;
// The cases this page runs: the file's own, or the variant the url selects.
let pageCases = fileCases;

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
): void {
  if (registering.has(name)) {
    throw new Error(`Two benchmarks share the name "${name}". Benchmark names must be unique.`);
  }
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;
  registering.set(name, {
    renderFn,
    interaction,
    options: options && {
      afterEach: options.afterEach,
      reactRecordingPaused: options.reactRecordingPaused,
    },
  });
}

/** Loads a variant's module, whose `benchmark()` calls define that variant's cases. */
export type VariantLoader = () => Promise<unknown>;

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
  const variantCases = new Map<string, PageCase>();
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

// Values custom metrics record during a measured sample. `null` outside one (module scope, warmup),
// where recorded values are dropped.
let sampleValues: RecordedValue[] | null = null;

setMetricRecorder((metric, value, options) => {
  sampleValues?.push({
    name: options?.id === undefined ? metric.name : `${metric.name}#${options.id}`,
    value,
  });
});

export interface BenchPage {
  caseNames: () => string[];
  /** The file's `compare()` calls, with their variant keys in order. */
  comparisons: () => Array<{ name: string; variants: string[] }>;
  /**
   * Runs one iteration of a case. A measured sample leaves its results as `performance.measure`
   * entries for the runner to collect; a warmup sample leaves none.
   */
  sample: (name: string, options: { warmup: boolean }) => Promise<void>;
}

declare global {
  interface Window {
    /** Set by `markPageReady()` once every benchmark file has registered its cases. */
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

function emitSample(
  result: Awaited<ReturnType<typeof measureIteration>>,
  values: RecordedValue[],
): void {
  // Render time is reported as totals rather than per render: an interaction's render count follows
  // whatever the browser coalesced, so per-render entries would not line up across iterations. The
  // per-phase split only adds information when there is more than one phase.
  const byPhase = new Map<string, number>();
  for (const render of result.renders) {
    byPhase.set(render.phase, (byPhase.get(render.phase) ?? 0) + render.actualDuration);
  }
  if (result.renders.length > 0) {
    const start = result.renders[0].startTime;
    const total = [...byPhase.values()].reduce((sum, duration) => sum + duration, 0);
    performance.measure('render', { start, duration: total, detail: { value: total } });
    if (byPhase.size > 1) {
      for (const [phase, duration] of byPhase) {
        performance.measure(`render:${phase}`, { start, duration, detail: { value: duration } });
      }
    }
  }
  for (const { id, start, end } of result.paints) {
    performance.measure(id === undefined ? 'bench:paint' : `bench:paint#${id}`, { start, end });
  }
  // Custom metrics aren't necessarily durations, so the value travels in `detail`.
  const now = performance.now();
  for (const { name, value } of values) {
    performance.measure(name, { start: now, duration: 0, detail: { value } });
  }
}

async function sample(name: string, { warmup }: { warmup: boolean }): Promise<void> {
  const benchCase = pageCases.get(name);
  if (!benchCase) {
    throw new Error(`No benchmark named "${name}". Known: ${[...pageCases.keys()].join(', ')}`);
  }
  performance.clearMarks();
  performance.clearMeasures();

  const values: RecordedValue[] = [];
  sampleValues = warmup ? null : values;
  let result: Awaited<ReturnType<typeof measureIteration>>;
  try {
    result = await measureIteration(
      benchCase.renderFn,
      benchCase.interaction,
      benchCase.options,
      input,
    );
  } finally {
    sampleValues = null;
  }

  if (result.renderError) {
    throw result.renderError;
  }
  if (result.hadEmptyActiveWindow) {
    throw new Error(
      'React recording was active but captured no renders. If you only measure imperative DOM ' +
        'updates or custom metrics, keep recording paused (reactRecordingPaused) instead of resuming.',
    );
  }
  if (!warmup) {
    emitSample(result, values);
  }
}

/**
 * Called by the generated page entry after it has imported every benchmark file. The runner waits
 * for `window.benchmarkPage`, or reads `window.benchmarkPageError` when getting ready failed.
 */
export async function markPageReady(): Promise<void> {
  if (typeof window.gc !== 'function') {
    console.warn(
      'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
    );
  }
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
    sample,
  };
}

import type * as React from 'react';
import { createInput } from '../input';
import {
  EMPTY_RECORDING_MESSAGE,
  measureIteration,
  MILLISECONDS,
  PAINT_METRIC_NAME,
  splitCaseArgs,
  warnIfNoGc,
} from '../caseRuntime';
import type {
  BenchmarkInteraction,
  BenchmarkOptions,
  CaseOptions,
  MeasuredIteration,
  VariantLoader,
} from '../caseRuntime';
import { seriesName, setMetricRecorder } from '../metricCore';
import type { MetricDefinition } from '../types';

// What `@mui/internal-benchmark` resolves to when benchmark files are built into a page for
// `benchmark run`. Same authoring API, different driver: `benchmark()` registers a case, and the
// runner calls `window.benchmarkPage.sample()` to run one iteration of it at a time. Every result
// leaves the page as a `performance.measure` entry, so it also shows up in a DevTools trace.

export * from '../publicApi';

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
  // The iteration counts in `options` are ignored here: the runner decides them.
  registering.set(name, { renderFn, ...splitCaseArgs(interactionOrOptions, maybeOptions) });
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

// The harness's own metrics. Render time and render count alarm on any resolved change for the
// worse; paint dominates each case's duration and duplicates that signal, so it is informational.
const metricDefinitions = new Map<string, MetricDefinition>([
  ['render', { kind: 'scalar', format: MILLISECONDS, alarm: {} }],
  ['render:count', { kind: 'discrete', alarm: {} }],
  ['render:mount', { kind: 'scalar', format: MILLISECONDS }],
  ['render:update', { kind: 'scalar', format: MILLISECONDS }],
  ['render:nested-update', { kind: 'scalar', format: MILLISECONDS }],
  [PAINT_METRIC_NAME, { kind: 'scalar', format: MILLISECONDS }],
]);

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
  /** Every metric reported so far, by name: the harness's own and those the cases recorded. */
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

function emitSample(result: MeasuredIteration, values: RecordedValue[]): void {
  // Render time is reported as totals rather than per render: an interaction's render count follows
  // whatever the browser coalesced, so per-render entries would not line up across iterations. The
  // per-phase split only adds information when there is more than one phase.
  const byPhase = new Map<string, number>();
  let total = 0;
  for (const render of result.renders) {
    byPhase.set(render.phase, (byPhase.get(render.phase) ?? 0) + render.actualDuration);
    total += render.actualDuration;
  }
  if (result.renders.length > 0) {
    const start = result.renders[0].startTime;
    performance.measure('render', { start, duration: total, detail: { value: total } });
    performance.measure('render:count', {
      start,
      duration: 0,
      detail: { value: result.renders.length },
    });
    if (byPhase.size > 1) {
      for (const [phase, duration] of byPhase) {
        performance.measure(`render:${phase}`, { start, duration, detail: { value: duration } });
      }
    }
  }
  for (const { id, start, end } of result.paints) {
    performance.measure(seriesName(PAINT_METRIC_NAME, id), { start, end });
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
  let result: MeasuredIteration;
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
    throw new Error(EMPTY_RECORDING_MESSAGE);
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
  warnIfNoGc();
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

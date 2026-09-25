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

const cases = new Map<string, PageCase>();

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
): void {
  if (cases.has(name)) {
    throw new Error(`Two benchmarks share the name "${name}". Benchmark names must be unique.`);
  }
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;
  cases.set(name, {
    renderFn,
    interaction,
    options: options && {
      afterEach: options.afterEach,
      reactRecordingPaused: options.reactRecordingPaused,
    },
  });
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
  const benchCase = cases.get(name);
  if (!benchCase) {
    throw new Error(`No benchmark named "${name}". Known: ${[...cases.keys()].join(', ')}`);
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

/** Called by the generated page entry after it has imported every benchmark file. */
export function markPageReady(): void {
  if (typeof window.gc !== 'function') {
    console.warn(
      'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
    );
  }
  window.benchmarkPage = { caseNames: () => [...cases.keys()], sample };
}

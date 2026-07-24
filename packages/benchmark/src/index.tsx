import * as React from 'react';
import { expect, it } from 'vitest';
import * as ReactDOMClient from 'react-dom/client'; // aliased to react-dom/profiling by Vite
import * as ReactDOM from 'react-dom';
import type { RenderEvent, IterationData, InteractionContext, BenchmarkCaseRuntime } from './types';
import { ElementTiming } from './ElementTiming';
import { ScalarMetric } from './ScalarMetric';
import { metricsGate } from './metricsGate';
import { createReactRecordingControls } from './reactRecording';
import type { ReactRecordingControls } from './reactRecording';
import { runProfileSession } from './profileSession';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

interface PerformanceElementTiming extends PerformanceEntry {
  readonly entryType: 'element';
  // When the browser started painting the element (i.e. the render phase ended). Preferred over
  // `renderTime`, which reports when the pixels reached the screen: that includes the wait for the
  // next display refresh, adding variance and time unrelated to the CPU-bound render work these
  // benchmarks optimize.
  readonly paintTime: DOMHighResTimeStamp;
  readonly identifier: string;
}

export type { RenderEvent, IterationData, InteractionContext } from './types';
export type {
  MetricKind,
  MetricDirection,
  MetricAlarm,
  MetricConfig,
  MetricDefinition,
} from './types';
export { ElementTiming } from './ElementTiming';
export { Metric, type MetricRecordOptions } from './Metric';
export { ScalarMetric };
export { DiscreteMetric } from './DiscreteMetric';

function BenchProfiler({
  captures,
  recording,
  children,
}: {
  captures: RenderEvent[];
  recording: ReactRecordingControls;
  children: React.ReactNode;
}) {
  const onRender = React.useCallback<React.ProfilerOnRenderCallback>(
    (id, phase, actualDuration, _baseDuration, startTime) => {
      // Skip renders captured while React recording is paused (e.g. the mount when the benchmark
      // starts paused, or a span the interaction explicitly excludes).
      if (recording.active) {
        captures.push({ id, phase, actualDuration, startTime });
        recording.markRendered();
      }
    },
    [captures, recording],
  );

  return (
    <React.Profiler id="bench" onRender={onRender}>
      {children}
    </React.Profiler>
  );
}

// Double GC: the first pass collects garbage, the second catches weak refs
// and prevent leaking into the next iteration.
function forceGC() {
  if (typeof window.gc === 'function') {
    window.gc();
    window.gc();
  }
}

declare global {
  interface Window {
    gc?: () => void;
  }
}

// Flush pending microtasks and React cleanup effects (e.g. from a previous unmount)
// so they don't interfere with the next iteration's timing.
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function supportsElementTiming(): boolean {
  return PerformanceObserver.supportedEntryTypes.includes('element');
}

interface ElementTimingWaiter {
  elementEntries: PerformanceElementTiming[];
  waitForElementTiming: (identifier: string, timeout?: number) => Promise<void>;
  disconnect: () => void;
}

// Sets up a PerformanceObserver for the Element Timing API and exposes a promise-based
// `waitForElementTiming` helper. Used by the measurement loop (which also reads `elementEntries`
// to record paint metrics) and the interactive profiling session.
function createElementTimingWaiter(): ElementTimingWaiter {
  const hasElementTiming = supportsElementTiming();
  const elementEntries: PerformanceElementTiming[] = [];
  const elementResolvers = new Map<string, () => void>();

  let observer: PerformanceObserver | null = null;
  if (hasElementTiming) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceElementTiming[]) {
        elementEntries.push(entry);
        const resolver = elementResolvers.get(entry.identifier);
        if (resolver) {
          elementResolvers.delete(entry.identifier);
          resolver();
        }
      }
    });
    observer.observe({ type: 'element', buffered: false });
  }

  const waitForElementTiming = (identifier: string, timeout?: number): Promise<void> => {
    if (!hasElementTiming) {
      console.warn(
        `waitForElementTiming("${identifier}"): Element Timing API is not supported. ` +
          'Paint metrics will not be collected.',
      );
      return Promise.resolve();
    }
    if (elementEntries.some((entry) => entry.identifier === identifier)) {
      return Promise.resolve();
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timeoutMs = timeout ?? 5000;
    const timer =
      timeoutMs > 0 && timeoutMs < Infinity
        ? setTimeout(() => {
            elementResolvers.delete(identifier);
            reject(
              new Error(
                `waitForElementTiming("${identifier}"): timed out after ${timeoutMs}ms. ` +
                  'Ensure the element has an `elementtiming` attribute and is visible in the viewport.',
              ),
            );
          }, timeoutMs)
        : undefined;
    elementResolvers.set(identifier, () => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve();
    });
    return promise;
  };

  return {
    elementEntries,
    waitForElementTiming,
    disconnect: () => observer?.disconnect(),
  };
}

// When true, `benchmark()` opens an interactive profiling session in a headed
// browser instead of running the automated measurement loop. Enabled by
// `createBenchmarkVitestConfig({ profile: true })` or `BENCHMARK_PROFILE=true`,
// both of which replace this expression at build time via Vite `define`.
const PROFILE_MODE = process.env.BENCHMARK_PROFILE === 'true';

interface CreateCaseRuntimeOptions {
  /**
   * Produces the case to mount. Measurement passes a renderFn already wrapped in `<BenchProfiler>`
   * to collect render events; profiling passes the case bare so the React Profiler overhead stays
   * out of the hand-captured DevTools trace.
   */
  renderFn: () => React.ReactElement;
  interaction?: (ctx: InteractionContext) => Promise<void> | void;
  /**
   * Context handed to the interaction callback. The driver assembles it: measurement supplies the
   * real React recording controls, profiling supplies no-ops since the user drives DevTools by hand.
   */
  context: InteractionContext;
  onUncaughtError?: (error: unknown) => void;
}

function createCaseRuntime({
  renderFn,
  interaction,
  context,
  onUncaughtError,
}: CreateCaseRuntimeOptions): BenchmarkCaseRuntime {
  let root: ReactDOMClient.Root | null = null;
  let container: HTMLElement | null = null;

  return {
    mount() {
      if (root) {
        return;
      }
      container = document.createElement('div');
      document.body.appendChild(container);
      const newRoot = ReactDOMClient.createRoot(container, { onUncaughtError });
      root = newRoot;
      ReactDOM.flushSync(() => {
        newRoot.render(
          <React.Fragment>
            {renderFn()}
            {/* Harness paint sentinel: emits the `default` Element Timing entry that
                `waitForElementTiming('default')` waits on, in both measurement and profile mode.
                Rendered as a sibling (outside renderFn / its BenchProfiler) so it isn't counted in
                the measured render duration. */}
            <ElementTiming name="default" />
          </React.Fragment>,
        );
      });
    },
    interact: interaction
      ? async () => {
          await interaction(context);
        }
      : undefined,
    unmount() {
      if (!root) {
        return;
      }
      root.unmount();
      container?.remove();
      root = null;
      container = null;
    },
    isMounted: () => root !== null,
  };
}

interface BenchmarkOptions {
  runs?: number;
  warmupRuns?: number;
  afterEach?: () => Promise<void> | void;
  /**
   * Start each iteration with React render/paint recording paused. The interaction callback then
   * calls `resumeReactRecording()` at the point it cares about — useful to exclude the mount and
   * measure only the renders/paint of a later interaction. Defaults to `false` (mount recorded).
   */
  reactRecordingPaused?: boolean;
}

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: ((ctx: InteractionContext) => Promise<void> | void) | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
) {
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;

  // In profile mode, skip the automated measurement loop entirely: build a bare case runtime (no
  // BenchProfiler wrapper, no-op recording since the user drives DevTools by hand) and hand it to
  // the interactive panel.
  if (PROFILE_MODE) {
    it(name, async () => {
      const timing = createElementTimingWaiter();
      // No `wrap`: profile mode renders the component bare (no BenchProfiler / React Profiler
      // overhead in the hand-captured trace). The runtime still plants the `default` sentinel, so
      // the first paint shows up as a labeled marker in the DevTools Performance timeline.
      const runtime = createCaseRuntime({
        renderFn,
        interaction,
        context: {
          waitForElementTiming: timing.waitForElementTiming,
          pauseReactRecording: () => {},
          resumeReactRecording: () => {},
        },
      });
      await runProfileSession(name, runtime);
      timing.disconnect();
    });
    return;
  }

  it(name, async ({ task }) => {
    const runs = options?.runs ?? 20;
    const warmupRuns = options?.warmupRuns ?? 10;

    const totalRuns = warmupRuns + runs;
    const iterations: IterationData[] = [];

    // Paint timings are recorded as one harness-owned `bench:paint` metric: the default sentinel
    // is the base series (`bench:paint`) and named `elementtiming` markers are sub-series
    // (`bench:paint#grid-header`, …), all sharing a single definition. Paint is informational (no
    // alarm): it dominates each test's total duration, so a per-test paint alarm just duplicates the
    // Duration regression signal and floods the report on any broadly-regressed run.
    const paint = new ScalarMetric({
      name: 'bench:paint',
      format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
    });

    if (typeof window.gc !== 'function') {
      console.warn(
        'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
      );
    }

    let renderError: unknown = null;
    // Set if any iteration had a recording window that was active yet captured no renders.
    let sawEmptyActiveWindow = false;

    for (let i = 0; i < totalRuns; i += 1) {
      const isWarmup = i < warmupRuns;

      // Custom metrics recorded inside the benchmark honor warmup exclusion through the gate, the
      // same way renders and `bench:paint` are excluded during warmup.
      metricsGate.setRecordingEnabled(task, !isWarmup);

      // Per-iteration switch for the harness's React render/paint recording. Starts paused when
      // `reactRecordingPaused` is set; the interaction callback drives it from there.
      const recording = createReactRecordingControls(!(options?.reactRecordingPaused ?? false));

      // Drain event loop from previous unmount, then double GC for thorough cleanup
      // eslint-disable-next-line no-await-in-loop
      await settle();
      forceGC();

      const captures: RenderEvent[] = [];
      const timing = createElementTimingWaiter();

      const runtime = createCaseRuntime({
        // Wrap the case in BenchProfiler so its renders are captured; the runtime mounts whatever
        // renderFn returns (profiling passes the case bare).
        renderFn: () => (
          <BenchProfiler captures={captures} recording={recording}>
            {renderFn()}
          </BenchProfiler>
        ),
        interaction,
        context: {
          waitForElementTiming: timing.waitForElementTiming,
          pauseReactRecording: recording.pauseReactRecording,
          resumeReactRecording: recording.resumeReactRecording,
        },
        // eslint-disable-next-line @typescript-eslint/no-loop-func
        onUncaughtError: (error) => {
          renderError = error;
        },
      });

      const iterationStart = performance.now();

      runtime.mount();

      if (renderError) {
        timing.disconnect();
        runtime.unmount();
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      await runtime.interact?.();

      // Wait for the bench sentinel paint entry (relies on test timeout)
      // eslint-disable-next-line no-await-in-loop
      await timing.waitForElementTiming('default', 0);

      // Close the final window and remember if any active window measured no renders.
      recording.finalizeWindow();
      if (recording.hadEmptyActiveWindow) {
        sawEmptyActiveWindow = true;
      }

      timing.disconnect();

      runtime.unmount();

      if (!isWarmup) {
        for (const entry of timing.elementEntries) {
          // Skip paints that happened while recording was paused. Attribute by the paint's
          // `paintTime`, not by when the observer callback fired (which can lag the paint).
          if (!recording.activeAt(entry.paintTime)) {
            continue;
          }
          // The default sentinel is the base series; named markers become sub-series.
          const id = entry.identifier === 'default' ? undefined : entry.identifier;
          paint.record(entry.paintTime - iterationStart, id !== undefined ? { id } : undefined);
        }
        iterations.push({ renders: captures });
      }

      if (options?.afterEach) {
        // eslint-disable-next-line no-await-in-loop
        await options.afterEach();
      }
    }

    task.meta.benchmarkIterations = iterations;
    task.meta.benchmarkName = name;

    if (renderError) {
      throw renderError;
    }

    // Every active recording window must capture at least one render. Windows where recording was
    // never running (e.g. a fully-paused, metric-only benchmark) are not checked.
    expect(
      sawEmptyActiveWindow,
      'React recording was active but captured no renders. If you only measure imperative DOM ' +
        'updates or custom metrics, keep recording paused (reactRecordingPaused) instead of resuming.',
    ).toBe(false);

    // Validate all iterations produced the same render events (count + order).
    // This runs after meta is set so the reporter can still display results on failure.
    if (iterations.length > 1) {
      const getEventKey = (event: RenderEvent) => `${event.id}:${event.phase}`;
      const expectedKeys = iterations[0].renders.map(getEventKey);

      for (let i = 1; i < iterations.length; i += 1) {
        const iterationKeys = iterations[i].renders.map(getEventKey);
        expect(iterationKeys, `Iteration ${i} render events differ from iteration 0`).toEqual(
          expectedKeys,
        );
      }
    }
  });
}

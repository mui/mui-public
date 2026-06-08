import * as React from 'react';
import { expect, it } from 'vitest';
import * as ReactDOMClient from 'react-dom/client'; // aliased to react-dom/profiling by Vite
import * as ReactDOM from 'react-dom';
import type { RenderEvent, IterationData, InteractionContext } from './types';
import { ElementTiming } from './ElementTiming';
import { ScalarMetric } from './ScalarMetric';
import { metricsGate } from './metricsGate';
import { createReactRecordingControls, type ReactRecordingControls } from './reactRecording';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

interface PerformanceElementTiming extends PerformanceEntry {
  readonly entryType: 'element';
  readonly renderTime: DOMHighResTimeStamp;
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
      }
    },
    [captures, recording],
  );

  return (
    <React.Profiler id="bench" onRender={onRender}>
      {children}
      <ElementTiming name="default" />
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

  it(name, async ({ task }) => {
    const runs = options?.runs ?? 20;
    const warmupRuns = options?.warmupRuns ?? 10;

    const totalRuns = warmupRuns + runs;
    const iterations: IterationData[] = [];

    // Paint timings are recorded as one harness-owned `bench:paint` metric: the default sentinel
    // is the base series (`bench:paint`) and named `elementtiming` markers are sub-series
    // (`bench:paint#grid-header`, …), all sharing a single definition. A default alarm keeps a
    // >20% paint regression flagged, matching the previous behavior.
    const paint = new ScalarMetric({
      name: 'bench:paint',
      format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
      alarm: { error: 0.2 },
    });

    const hasElementTiming = supportsElementTiming();

    if (typeof window.gc !== 'function') {
      console.warn(
        'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
      );
    }

    let renderError: unknown = null;

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
      const elementEntries: PerformanceElementTiming[] = [];
      const elementResolvers = new Map<string, () => void>();

      // Set up Element Timing observer
      let elementObserver: PerformanceObserver | null = null;
      if (hasElementTiming) {
        elementObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceElementTiming[]) {
            elementEntries.push(entry);
            const resolver = elementResolvers.get(entry.identifier);
            if (resolver) {
              elementResolvers.delete(entry.identifier);
              resolver();
            }
          }
        });
        elementObserver.observe({ type: 'element', buffered: false });
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

      const iterationStart = performance.now();

      const container = document.createElement('div');
      document.body.appendChild(container);

      const root = ReactDOMClient.createRoot(container, {
        // eslint-disable-next-line @typescript-eslint/no-loop-func
        onUncaughtError: (error) => {
          renderError = error;
        },
      });

      ReactDOM.flushSync(() => {
        root.render(
          <BenchProfiler captures={captures} recording={recording}>
            {renderFn()}
          </BenchProfiler>,
        );
      });

      if (renderError) {
        elementObserver?.disconnect();
        root.unmount();
        container.remove();
        break;
      }

      if (interaction) {
        // eslint-disable-next-line no-await-in-loop
        await interaction({
          waitForElementTiming,
          pauseReactRecording: recording.pauseReactRecording,
          resumeReactRecording: recording.resumeReactRecording,
        });
      }

      // Wait for the bench sentinel paint entry (relies on test timeout)
      // eslint-disable-next-line no-await-in-loop
      await waitForElementTiming('default', 0);

      elementObserver?.disconnect();

      root.unmount();
      container.remove();

      if (!isWarmup) {
        for (const entry of elementEntries) {
          // Skip paints that happened while recording was paused. Attribute by the paint's
          // `renderTime`, not by when the observer callback fired (which can lag the paint).
          if (!recording.activeAt(entry.renderTime)) {
            continue;
          }
          // The default sentinel is the base series; named markers become sub-series.
          const id = entry.identifier === 'default' ? undefined : entry.identifier;
          paint.record(entry.renderTime - iterationStart, id !== undefined ? { id } : undefined);
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

    // Validate that at least one render was recorded
    expect(
      iterations[0].renders.length,
      'No renders were recorded during benchmark',
    ).toBeGreaterThan(0);

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

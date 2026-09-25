import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client'; // aliased to react-dom/profiling by Vite
import * as ReactDOM from 'react-dom';
import type { RenderEvent, InteractionContext, BenchmarkCaseRuntime } from './types';
import type { BenchmarkInput } from './input';
import { ElementTiming } from './ElementTiming';
import { createReactRecordingControls } from './reactRecording';
import type { ReactRecordingControls } from './reactRecording';

// Everything here runs a case without knowing who drives it: the Vitest harness (`index.tsx`) and
// the A/B page (`page/page.tsx`) both build on it, so nothing in this module may import Vitest.

interface PerformanceElementTiming extends PerformanceEntry {
  readonly entryType: 'element';
  // When the browser started painting the element (i.e. the render phase ended). Preferred over
  // `renderTime`, which reports when the pixels reached the screen: that includes the wait for the
  // next display refresh, adding variance and time unrelated to the CPU-bound render work these
  // benchmarks optimize.
  readonly paintTime: DOMHighResTimeStamp;
  readonly identifier: string;
}

export type BenchmarkInteraction = (ctx: InteractionContext) => Promise<void> | void;

export interface CaseOptions {
  afterEach?: () => Promise<void> | void;
  /**
   * Start each iteration with React render/paint recording paused. The interaction callback then
   * calls `resumeReactRecording()` at the point it cares about — useful to exclude the mount and
   * measure only the renders/paint of a later interaction. Defaults to `false` (mount recorded).
   */
  reactRecordingPaused?: boolean;
}

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
export function createElementTimingWaiter(): ElementTimingWaiter {
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

interface CreateCaseRuntimeOptions {
  /**
   * Produces the case to mount. Measurement passes a renderFn already wrapped in `<BenchProfiler>`
   * to collect render events; profiling passes the case bare so the React Profiler overhead stays
   * out of the hand-captured DevTools trace.
   */
  renderFn: () => React.ReactElement;
  interaction?: BenchmarkInteraction;
  /**
   * Context handed to the interaction callback. The driver assembles it: measurement supplies the
   * real React recording controls, profiling supplies no-ops since the user drives DevTools by hand.
   */
  context: InteractionContext;
  onUncaughtError?: (error: unknown) => void;
}

export function createCaseRuntime({
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

export interface PaintTiming {
  /** The `elementtiming` identifier; `undefined` for the harness's `default` sentinel. */
  id: string | undefined;
  /** `performance.now()` when the iteration started, before mounting. */
  start: number;
  /** The element's `paintTime`. */
  end: number;
}

export interface MeasuredIteration {
  /** Renders captured while React recording was active. */
  renders: RenderEvent[];
  /** Element paints that happened while React recording was active. */
  paints: PaintTiming[];
  /** The error a render threw, if one did. The iteration stops at mount when it does. */
  renderError: unknown;
  /** Whether a recording window was active yet captured no renders. */
  hadEmptyActiveWindow: boolean;
}

/**
 * Mounts, interacts with and unmounts a case once. Records nothing itself: renders and paints are
 * returned, and the driver decides whether they count (they don't during warmup) and where they go.
 */
export async function measureIteration(
  renderFn: () => React.ReactElement,
  interaction: BenchmarkInteraction | undefined,
  options: CaseOptions | undefined,
  input: BenchmarkInput,
): Promise<MeasuredIteration> {
  // Per-iteration switch for the harness's React render/paint recording. Starts paused when
  // `reactRecordingPaused` is set; the interaction callback drives it from there.
  const recording = createReactRecordingControls(!(options?.reactRecordingPaused ?? false));

  // Drain event loop from previous unmount, then double GC for thorough cleanup
  await settle();
  forceGC();

  const captures: RenderEvent[] = [];
  const timing = createElementTimingWaiter();
  let renderError: unknown = null;

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
      input,
    },
    onUncaughtError: (error) => {
      renderError = error;
    },
  });

  const iterationStart = performance.now();

  runtime.mount();

  if (renderError) {
    timing.disconnect();
    runtime.unmount();
    return { renders: captures, paints: [], renderError, hadEmptyActiveWindow: false };
  }

  await runtime.interact?.();

  // Wait for the bench sentinel paint entry (relies on the driver's timeout)
  await timing.waitForElementTiming('default', 0);

  // Close the final window so an active window that measured no renders is flagged.
  recording.finalizeWindow();

  timing.disconnect();

  runtime.unmount();

  const paints: PaintTiming[] = [];
  for (const entry of timing.elementEntries) {
    // Skip paints that happened while recording was paused. Attribute by the paint's
    // `paintTime`, not by when the observer callback fired (which can lag the paint).
    if (!recording.activeAt(entry.paintTime)) {
      continue;
    }
    // The default sentinel is the base series; named markers become sub-series.
    const id = entry.identifier === 'default' ? undefined : entry.identifier;
    paints.push({ id, start: iterationStart, end: entry.paintTime });
  }

  if (options?.afterEach) {
    await options.afterEach();
  }

  return {
    renders: captures,
    paints,
    renderError,
    hadEmptyActiveWindow: recording.hadEmptyActiveWindow,
  };
}

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
        recording.markRendered();
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

// When true, `benchmark()` opens an interactive profiling session in a headed
// browser instead of running the automated measurement loop. Enabled by
// `createBenchmarkVitestConfig({ profile: true })` or `BENCHMARK_PROFILE=true`,
// both of which replace this expression at build time via Vite `define`.
const PROFILE_MODE = process.env.BENCHMARK_PROFILE === 'true';

interface ElementTimingWaiter {
  elementEntries: PerformanceElementTiming[];
  waitForElementTiming: (identifier: string, timeout?: number) => Promise<void>;
  disconnect: () => void;
}

// Sets up a PerformanceObserver for the Element Timing API and exposes a
// promise-based `waitForElementTiming` helper. Shared by the measurement loop
// and the interactive profiling session.
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

const PROFILE_PANEL_STYLE = [
  'position:fixed',
  'top:0',
  'left:0',
  'right:0',
  'z-index:2147483647',
  'display:flex',
  'gap:8px',
  'align-items:center',
  'box-sizing:border-box',
  'padding:8px 12px',
  'background:#1e1e1e',
  'color:#fff',
  'font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  'box-shadow:0 1px 6px rgba(0,0,0,0.5)',
].join(';');

const PROFILE_BUTTON_STYLE = [
  'padding:4px 10px',
  'border:1px solid #555',
  'border-radius:4px',
  'background:#333',
  'color:#fff',
  'cursor:pointer',
  'font:inherit',
].join(';');

function createProfileButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = PROFILE_BUTTON_STYLE;
  return button;
}

// Interactive profiling session: instead of measuring, render a control panel
// with Render / Unmount / Run interaction / Finish buttons. The component under
// test stays unmounted until the user clicks "Render", giving them time to start
// the DevTools profiler first. The returned promise resolves on "Finish", which
// is what keeps the Vitest test (and the headed browser window) alive in between.
function runProfileSession(
  name: string,
  renderFn: () => React.ReactElement,
  interaction?: (ctx: InteractionContext) => Promise<void> | void,
): Promise<void> {
  const panel = document.createElement('div');
  panel.setAttribute('data-benchmark-profile-panel', '');
  panel.style.cssText = PROFILE_PANEL_STYLE;

  const title = document.createElement('span');
  title.textContent = `⏱ ${name}`;
  title.style.cssText = 'font-weight:600;white-space:nowrap';

  const status = document.createElement('span');
  status.style.cssText = 'margin-left:auto;opacity:0.85;white-space:nowrap';

  const renderButton = createProfileButton('▶ Render');
  const interactButton = interaction ? createProfileButton('⚡ Run interaction') : null;
  const finishButton = createProfileButton('✓ Finish');

  if (interactButton) {
    interactButton.disabled = true;
  }

  panel.appendChild(title);
  panel.appendChild(renderButton);
  if (interactButton) {
    panel.appendChild(interactButton);
  }
  panel.appendChild(finishButton);
  panel.appendChild(status);
  document.body.appendChild(panel);

  // Push page content below the fixed panel so it doesn't cover the component.
  const spacer = document.createElement('div');
  spacer.style.height = `${panel.offsetHeight}px`;
  document.body.insertBefore(spacer, panel);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const timing = createElementTimingWaiter();
  let root: ReactDOMClient.Root | null = null;

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  const show = () => {
    if (root) {
      return;
    }
    root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root!.render(renderFn());
    });
    renderButton.textContent = '■ Unmount';
    if (interactButton) {
      interactButton.disabled = false;
    }
    setStatus('rendered — capture your profile, then Unmount or Finish');
  };

  const hide = () => {
    if (!root) {
      return;
    }
    root.unmount();
    root = null;
    renderButton.textContent = '▶ Render';
    if (interactButton) {
      interactButton.disabled = true;
    }
    setStatus('unmounted — Render again or Finish');
  };

  setStatus('idle — start the DevTools profiler, then click Render');

  return new Promise<void>((resolve) => {
    renderButton.addEventListener('click', () => (root ? hide() : show()));

    if (interactButton && interaction) {
      interactButton.addEventListener('click', async () => {
        interactButton.disabled = true;
        setStatus('running interaction…');
        try {
          await interaction({
            waitForElementTiming: timing.waitForElementTiming,
            // No harness recording in interactive profile mode — the user drives the DevTools
            // profiler — so the recording controls are no-ops here.
            pauseReactRecording: () => {},
            resumeReactRecording: () => {},
          });
          setStatus('interaction done');
        } catch (error) {
          setStatus(`interaction error: ${String(error)}`);
        } finally {
          if (root) {
            interactButton.disabled = false;
          }
        }
      });
    }

    finishButton.addEventListener('click', () => {
      hide();
      timing.disconnect();
      spacer.remove();
      container.remove();
      panel.remove();
      resolve();
    });
  });
}

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: ((ctx: InteractionContext) => Promise<void> | void) | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
) {
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;

  // In profile mode, skip the automated measurement loop entirely and hand the
  // case to an interactive session so a human can drive the DevTools profiler.
  if (PROFILE_MODE) {
    it(name, async () => {
      await runProfileSession(name, renderFn, interaction);
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
    // (`bench:paint#grid-header`, …), all sharing a single definition. A default alarm keeps a
    // >20% paint regression flagged, matching the previous behavior.
    const paint = new ScalarMetric({
      name: 'bench:paint',
      format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
      alarm: { error: 0.2 },
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
      const { elementEntries, waitForElementTiming, disconnect } = createElementTimingWaiter();

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
        disconnect();
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

      // Close the final window and remember if any active window measured no renders.
      recording.finalizeWindow();
      if (recording.hadEmptyActiveWindow) {
        sawEmptyActiveWindow = true;
      }

      disconnect();

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

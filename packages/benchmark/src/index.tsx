import type * as React from 'react';
import { expect, it, TestRunner } from 'vitest';
import type { RunnerTestCase } from 'vitest';
import { cdp } from 'vitest/browser';
import type { RenderEvent, IterationData } from './types';
import { ScalarMetric } from './ScalarMetric';
import { metricsGate } from './metricsGate';
import { runProfileSession } from './profileSession';
import { createInput } from './input';
import { createCaseRuntime, createElementTimingWaiter, measureIteration } from './caseRuntime';
import type { BenchmarkInteraction, CaseOptions } from './caseRuntime';
// Installs the Vitest metric recorder.
import './Metric';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

export type { RenderEvent, IterationData, InteractionContext } from './types';
export type {
  MetricKind,
  MetricDirection,
  MetricAlarm,
  MetricConfig,
  MetricDefinition,
} from './types';
export type { BenchmarkInput } from './input';
export type { BenchmarkInteraction } from './caseRuntime';
export { ElementTiming } from './ElementTiming';
export { Metric, type MetricRecordOptions } from './Metric';
export { ScalarMetric };
export { DiscreteMetric } from './DiscreteMetric';

// When true, `benchmark()` opens an interactive profiling session in a headed
// browser instead of running the automated measurement loop. Enabled by
// `createBenchmarkVitestConfig({ profile: true })` or `BENCHMARK_PROFILE=true`,
// both of which replace this expression at build time via Vite `define`.
const PROFILE_MODE = process.env.BENCHMARK_PROFILE === 'true';

type CdpMethod = Parameters<ReturnType<typeof cdp>['send']>[0];

// Gestures go through the CDP session Vitest's Playwright provider holds for the test page. The
// session's `send` only accepts protocol method names it knows; `input.send` takes any string and
// leaves unknown methods for Chrome to reject.
const input = createInput((method, params) => cdp().send(method as CdpMethod, params));

export interface BenchmarkOptions extends CaseOptions {
  runs?: number;
  warmupRuns?: number;
}

export interface RunCaseOptions extends CaseOptions {
  /**
   * Run the iteration without recording anything: no `bench:paint`, and custom metrics recorded
   * inside the case are dropped. Defaults to `false`.
   */
  warmup?: boolean;
}

export interface RunCaseResult {
  /** Renders captured while React recording was active. */
  renders: RenderEvent[];
  /** The error a render threw, if one did. The iteration stops at mount when it does. */
  renderError: unknown;
  /** Whether a recording window was active yet captured no renders. */
  hadEmptyActiveWindow: boolean;
}

// Paint timings are recorded as one harness-owned `bench:paint` metric: the default sentinel
// is the base series (`bench:paint`) and named `elementtiming` markers are sub-series
// (`bench:paint#grid-header`, …), all sharing a single definition. Paint is informational (no
// alarm): it dominates each test's total duration, so a per-test paint alarm just duplicates the
// Duration regression signal and floods the report on any broadly-regressed run.
const paint = new ScalarMetric({
  name: 'bench:paint',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});

async function measureAndRecord(
  renderFn: () => React.ReactElement,
  interaction: BenchmarkInteraction | undefined,
  options: RunCaseOptions | undefined,
): Promise<RunCaseResult> {
  const { renders, paints, renderError, hadEmptyActiveWindow } = await measureIteration(
    renderFn,
    interaction,
    options,
    input,
  );
  if (!options?.warmup) {
    for (const { id, start, end } of paints) {
      paint.record(end - start, id !== undefined ? { id } : undefined);
    }
  }
  return { renders, renderError, hadEmptyActiveWindow };
}

/**
 * Mounts, interacts with and unmounts a case exactly once, recording its renders and paint.
 *
 * This is the primitive `benchmark()` loops over. How many iterations to run, in which order, and
 * how to aggregate them is up to the caller, so a driver can run cases differently — e.g. an A/B
 * runner alternating two builds iteration by iteration instead of in blocks. It registers and
 * asserts nothing; the caller decides what a render error or empty recording window means.
 *
 * Metrics resolve the running Vitest test when they record, so measured (non-warmup) iterations
 * must run inside one.
 */
export async function runCase(
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | RunCaseOptions,
  maybeOptions?: RunCaseOptions,
): Promise<RunCaseResult> {
  const interaction = typeof interactionOrOptions === 'function' ? interactionOrOptions : undefined;
  const options = typeof interactionOrOptions === 'object' ? interactionOrOptions : maybeOptions;

  // Custom metrics recorded inside the case honor warmup exclusion through the gate, the same way
  // renders and `bench:paint` are excluded during warmup. The gate is keyed on the running test,
  // and is re-enabled afterwards so metrics the driver records between iterations are kept.
  const test = TestRunner.getCurrentTest<RunnerTestCase | undefined>();
  if (!test) {
    return measureAndRecord(renderFn, interaction, options);
  }
  metricsGate.setRecordingEnabled(test, !options?.warmup);
  try {
    return await measureAndRecord(renderFn, interaction, options);
  } finally {
    metricsGate.setRecordingEnabled(test, true);
  }
}

export function benchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | BenchmarkOptions,
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
          input,
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

    if (typeof window.gc !== 'function') {
      console.warn(
        'window.gc is not available. Run with --js-flags=--expose-gc for consistent GC between iterations.',
      );
    }

    const iterations: IterationData[] = [];
    let renderError: unknown = null;
    // Set if any iteration had a recording window that was active yet captured no renders.
    let sawEmptyActiveWindow = false;

    for (let i = 0; i < warmupRuns + runs; i += 1) {
      const warmup = i < warmupRuns;
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(renderFn, interaction, {
        afterEach: options?.afterEach,
        reactRecordingPaused: options?.reactRecordingPaused,
        warmup,
      });
      if (result.renderError) {
        renderError = result.renderError;
        break;
      }
      if (result.hadEmptyActiveWindow) {
        sawEmptyActiveWindow = true;
      }
      if (!warmup) {
        iterations.push({ renders: result.renders });
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

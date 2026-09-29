import type * as React from 'react';
import { describe, expect, it, TestRunner } from 'vitest';
import type { RunnerTestCase } from 'vitest';
import { cdp } from 'vitest/browser';
import type { RenderEvent, IterationData } from './types';
import { ScalarMetric } from './ScalarMetric';
import { metricsGate } from './metricsGate';
import { runProfileSession } from './profileSession';
import { createInput } from './input';
import {
  createCaseRuntime,
  createElementTimingWaiter,
  EMPTY_RECORDING_MESSAGE,
  measureIteration,
  MILLISECONDS,
  PAINT_METRIC_NAME,
  splitCaseArgs,
  warnIfNoGc,
} from './caseRuntime';
import type {
  BenchmarkInteraction,
  BenchmarkOptions,
  CaseOptions,
  VariantLoader,
} from './caseRuntime';
// Installs the Vitest metric recorder.
import './Metric';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

export * from './publicApi';
export type { VariantLoader };

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
  name: PAINT_METRIC_NAME,
  format: MILLISECONDS,
});

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
  const { interaction, options } = splitCaseArgs(interactionOrOptions, maybeOptions);

  // Custom metrics recorded inside the case honor warmup exclusion through the gate, the same way
  // renders and `bench:paint` are excluded during warmup. The gate is keyed on the running test,
  // and is re-enabled afterwards so metrics the driver records between iterations are kept.
  const test = TestRunner.getCurrentTest<RunnerTestCase | undefined>();
  if (test) {
    metricsGate.setRecordingEnabled(test, !options?.warmup);
  }
  try {
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
  } finally {
    if (test) {
      metricsGate.setRecordingEnabled(test, true);
    }
  }
}

// The `compare()` variant whose module is loading, so its `benchmark()` calls can say whose they are.
let loadingVariant: string | undefined;

/**
 * Compares implementations against each other — one library against another, say. Each variant is
 * a module of ordinary `benchmark()` calls; cases are paired across variants by name, and the first
 * variant is the reference.
 *
 * Vitest has no notion of variants, so here every variant's cases simply run as tests of their own,
 * suffixed with the variant: `mount [recharts]`. The interleaved engine is what compares them.
 */
export function compare(name: string, variants: Record<string, VariantLoader>): void {
  describe(name, async () => {
    for (const [key, load] of Object.entries(variants)) {
      loadingVariant = key;
      try {
        // eslint-disable-next-line no-await-in-loop
        await load();
      } finally {
        loadingVariant = undefined;
      }
    }
  });
}

export function benchmark(
  caseName: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | BenchmarkOptions,
  maybeOptions?: BenchmarkOptions,
) {
  const { interaction, options } = splitCaseArgs(interactionOrOptions, maybeOptions);
  const name = loadingVariant === undefined ? caseName : `${caseName} [${loadingVariant}]`;

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

    warnIfNoGc();

    const iterations: IterationData[] = [];
    let renderError: unknown = null;
    // Set if any iteration had a recording window that was active yet captured no renders.
    let sawEmptyActiveWindow = false;

    for (let i = 0; i < warmupRuns + runs; i += 1) {
      const warmup = i < warmupRuns;
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(renderFn, interaction, { ...options, warmup });
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
    expect(sawEmptyActiveWindow, EMPTY_RECORDING_MESSAGE).toBe(false);

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

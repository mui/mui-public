import type * as React from 'react';
import { expect, it } from 'vitest';
import type { RunnerTestCase } from 'vitest';
import { cdp } from 'vitest/browser';
import type { RenderEvent, IterationData } from './types';
import { ScalarMetric } from './ScalarMetric';
import { metricsGate } from './metricsGate';
import { runProfileSession } from './profileSession';
import { createInput } from './input';
import type { CdpSend } from './input';
import { collectGarbage } from './gc';
import {
  createCaseRuntime,
  createElementTimingWaiter,
  measureIteration,
  MILLISECONDS,
  PAINT_METRIC_NAME,
  splitCaseArgs,
} from './caseRuntime';
import type { BenchmarkInteraction, BenchmarkOptions, CaseOptions } from './caseRuntime';
// Installs the Vitest metric recorder.
import './Metric';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

export * from './publicApi';
export type { BenchmarkOptions };

// When true, `benchmark()` opens an interactive profiling session in a headed
// browser instead of running the automated measurement loop. Enabled by
// `createBenchmarkVitestConfig({ profile: true })` or `BENCHMARK_PROFILE=true`,
// both of which replace this expression at build time via Vite `define`.
const PROFILE_MODE = process.env.BENCHMARK_PROFILE === 'true';

type CdpMethod = Parameters<ReturnType<typeof cdp>['send']>[0];

// Gestures and `cdp` go through the CDP session Vitest's Playwright provider holds for the test
// page. The session's `send` only accepts protocol method names it knows; ours takes any string and
// leaves unknown methods for Chrome to reject.
const send: CdpSend = (method, params) => cdp().send(method as CdpMethod, params);
const driver = { input: createInput(send), cdp: { send } };

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
 * Runs one iteration of a case inside the running Vitest test, returning its renders. A warmup
 * iteration records nothing: no `bench:paint`, and custom metrics recorded inside the case are
 * dropped.
 */
async function runIteration(
  test: RunnerTestCase,
  renderFn: () => React.ReactElement,
  interaction: BenchmarkInteraction | undefined,
  options: CaseOptions | undefined,
  warmup: boolean,
): Promise<RenderEvent[]> {
  // Custom metrics recorded inside the case honor warmup exclusion through the gate, the same way
  // renders and `bench:paint` are excluded during warmup.
  await collectGarbage();
  metricsGate.setRecordingEnabled(test, !warmup);
  try {
    const { renders, paints } = await measureIteration(renderFn, interaction, options, driver);
    if (!warmup) {
      for (const { id, start, end } of paints) {
        paint.record(end - start, id !== undefined ? { id } : undefined);
      }
    }
    return renders;
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
  const { interaction, options } = splitCaseArgs(interactionOrOptions, maybeOptions);

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
          ...driver,
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

    const iterations: IterationData[] = [];
    try {
      for (let i = 0; i < warmupRuns + runs; i += 1) {
        const warmup = i < warmupRuns;
        // eslint-disable-next-line no-await-in-loop
        const renders = await runIteration(task, renderFn, interaction, options, warmup);
        if (!warmup) {
          iterations.push({ renders });
        }
      }
    } finally {
      // Set even when an iteration throws, so the reporter can show what was measured.
      task.meta.benchmarkIterations = iterations;
      task.meta.benchmarkName = name;
    }

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

import type * as React from 'react';
import {
  EMPTY_RECORDING_MESSAGE,
  measureIteration,
  MILLISECONDS,
  PAINT_METRIC_NAME,
  splitCaseArgs,
  warnIfNoGc,
} from '../caseRuntime';
import type { BenchmarkInteraction, CaseOptions } from '../caseRuntime';
import { DiscreteMetric } from '../DiscreteMetric';
import { ScalarMetric } from '../ScalarMetric';
import { benchmark } from './page';
import type { BenchmarkCase } from './page';

export type ReactBenchmarkOptions = CaseOptions;

// Render time and render count alarm on any resolved change for the worse; paint dominates each
// case's duration and duplicates that signal, so it is informational, as is the per-phase split.
const renderMetric = new ScalarMetric({ name: 'render', format: MILLISECONDS, alarm: {} });
const renderCountMetric = new DiscreteMetric({ name: 'render:count', alarm: {} });
const paintMetric = new ScalarMetric({ name: PAINT_METRIC_NAME, format: MILLISECONDS });
const phaseMetrics = new Map<string, ScalarMetric>();

function phaseMetricOf(phase: string): ScalarMetric {
  let metric = phaseMetrics.get(phase);
  if (!metric) {
    metric = new ScalarMetric({ name: `render:${phase}`, format: MILLISECONDS });
    phaseMetrics.set(phase, metric);
  }
  return metric;
}

// Every iteration forces a GC before mounting, which needs `--expose-gc`; warned about once.
let checkedGc = false;

/**
 * Registers a React benchmark case: every sample mounts `renderFn()`, runs the interaction, waits
 * for the paint and unmounts. It records the renders React's profiler captured and the time to
 * paint; custom metrics recorded along the way are reported with them.
 */
export function reactBenchmark(
  name: string,
  renderFn: () => React.ReactElement,
  interactionOrOptions?: BenchmarkInteraction | ReactBenchmarkOptions,
  maybeOptions?: ReactBenchmarkOptions,
): BenchmarkCase {
  if (!checkedGc) {
    checkedGc = true;
    warnIfNoGc();
  }
  const { interaction, options } = splitCaseArgs(interactionOrOptions, maybeOptions);

  return benchmark(name, async ({ input }) => {
    const result = await measureIteration(renderFn, interaction, options, input);
    if (result.renderError) {
      throw result.renderError;
    }
    if (result.hadEmptyActiveWindow) {
      throw new Error(EMPTY_RECORDING_MESSAGE);
    }

    // Render time is reported as totals rather than per render: an interaction's render count
    // follows whatever the browser coalesced, so per-render values would not line up across
    // iterations. The per-phase split only adds information when there is more than one phase.
    if (result.renders.length > 0) {
      const byPhase = new Map<string, number>();
      let total = 0;
      for (const render of result.renders) {
        byPhase.set(render.phase, (byPhase.get(render.phase) ?? 0) + render.actualDuration);
        total += render.actualDuration;
      }
      renderMetric.record(total);
      renderCountMetric.record(result.renders.length);
      if (byPhase.size > 1) {
        for (const [phase, duration] of byPhase) {
          phaseMetricOf(phase).record(duration);
        }
      }
    }
    for (const { id, start, end } of result.paints) {
      paintMetric.record(end - start, id === undefined ? undefined : { id });
    }
  });
}

import type * as React from 'react';
import { measureIteration, MILLISECONDS, PAINT_METRIC_NAME, splitCaseArgs } from '../caseRuntime';
import type { BenchmarkInteraction, CaseOptions } from '../caseRuntime';
import { DiscreteMetric } from '../DiscreteMetric';
import { ScalarMetric } from '../ScalarMetric';
import type { SamplingOptions } from '../sampling';
import type { RunMetricAlarm } from '../runReport/schema';
import { DEFAULT_ERROR_BAND } from '../runReport/analyzeRun';
import { benchmark } from './page';
import type { BenchmarkCase, BenchmarkContext } from './page';

export interface ReactBenchmarkOptions extends CaseOptions, SamplingOptions {
  /**
   * This benchmark's own alarm for `render` and `bench:paint`, in place of the default 5% `error`
   * band: a lower band for a benchmark that matters more, a higher one for one that matters less,
   * or `false` for a benchmark that never alarms.
   */
  alarm?: RunMetricAlarm | false;
}

// Render time and paint both alarm: render is React running the components, while paint adds what
// follows — the commit, injected styles, style recalculation and layout — so a styling or DOM
// regression can show in paint alone. Both alarm once a change for the worse is confidently 5%,
// unless the benchmark sets its own `alarm`; smaller confirmed changes show on the dashboard and are
// left to the timelines. The render count is informational: an extra render matters only through the time it
// adds, which render time already measures. So is the per-phase split.
const TIME_ALARM = { error: DEFAULT_ERROR_BAND };
const renderMetric = new ScalarMetric({ name: 'render', format: MILLISECONDS, alarm: TIME_ALARM });
const renderCountMetric = new DiscreteMetric({ name: 'render:count' });
const paintMetric = new ScalarMetric({
  name: PAINT_METRIC_NAME,
  format: MILLISECONDS,
  alarm: TIME_ALARM,
});
const phaseMetrics = new Map<string, ScalarMetric>();

function phaseMetricOf(phase: string): ScalarMetric {
  let metric = phaseMetrics.get(phase);
  if (!metric) {
    metric = new ScalarMetric({ name: `render:${phase}`, format: MILLISECONDS });
    phaseMetrics.set(phase, metric);
  }
  return metric;
}

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
  const { interaction, options } = splitCaseArgs(interactionOrOptions, maybeOptions);

  const run = async ({ input, cdp }: BenchmarkContext) => {
    const result = await measureIteration(renderFn, interaction, options, { input, cdp });

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
  };
  const alarm = options?.alarm;
  return benchmark(name, run, {
    ...options,
    alarms:
      alarm === undefined ? undefined : { [renderMetric.name]: alarm, [paintMetric.name]: alarm },
  });
}

import type * as React from 'react';
import { measureIteration, MILLISECONDS, PAINT_METRIC_NAME, splitCaseArgs } from '../caseRuntime';
import type { BenchmarkInteraction, CaseOptions } from '../caseRuntime';
import { DiscreteMetric } from '../DiscreteMetric';
import { ScalarMetric } from '../ScalarMetric';
import type { SamplingOptions } from '../sampling';
import { benchmark } from './page';
import type { BenchmarkCase, BenchmarkContext } from './page';

export interface ReactBenchmarkOptions extends CaseOptions, SamplingOptions {}

// Render time and paint both alarm: render is React running the components, while paint adds what
// follows — the commit, injected styles, style recalculation and layout — so a styling or DOM
// regression can show in paint alone. Both warn once a change for the worse is confidently 2% and
// fail at 5%, the size sampling is built to settle; smaller confirmed changes are left to the
// timelines. The render count is informational: an extra render matters only through the time it
// adds, which render time already measures. So is the per-phase split.
const TIME_ALARM = { warn: 0.02, error: 0.05 };
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
  return benchmark(name, run, options);
}

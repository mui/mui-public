import type { BenchmarkCdp } from '../cdp';
import { warmUpCpu } from './warmUpCpu';

// Main-thread task time, read from Chromium's activity counters over the DevTools Protocol
// (`Performance.getMetrics`). It counts the work of code that draws outside React as well, which
// render durations don't see, so it compares any two implementations of the same interaction.

interface PerformanceMetric {
  name: string;
  value: number;
}

// The page is loaded afresh every round, so this resets with it.
let performanceDomainEnabled = false;

async function getPerformanceMetrics(cdp: BenchmarkCdp): Promise<PerformanceMetric[]> {
  if (!performanceDomainEnabled) {
    await cdp.send('Performance.enable');
    performanceDomainEnabled = true;
  }
  const result = (await cdp.send('Performance.getMetrics')) as { metrics: PerformanceMetric[] };
  return result.metrics;
}

/**
 * A counter the measurement is computed from. A missing one throws rather than reading as 0, which
 * would make every interaction look free: a broken benchmark would read as an excellent score.
 */
function requiredMetricValue(metrics: PerformanceMetric[], name: string): number {
  const metric = metrics.find((entry) => entry.name === name);
  if (metric === undefined) {
    throw new Error(
      `Chromium reported no "${name}" performance counter, so main-thread task time can't be ` +
        "measured. Check the DevTools Protocol's Performance domain against this Chromium version.",
    );
  }
  return metric.value;
}

function metricValue(metrics: PerformanceMetric[], name: string): number {
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

/**
 * Cumulative main-thread task time since page load, in milliseconds: every task, whatever its kind,
 * less the renderer's own DevTools command handling, so reading the counters doesn't bill itself.
 * `TaskDuration` rather than a sum of script, layout and style time: rendering that none of those
 * counters names is real work, and code that draws outside React does much of its work there.
 */
function mainThreadTaskMs(metrics: PerformanceMetric[]): number {
  const taskDuration = requiredMetricValue(metrics, 'TaskDuration');
  const devToolsCommandDuration = requiredMetricValue(metrics, 'DevToolsCommandDuration');
  return (taskDuration - devToolsCommandDuration) * 1000;
}

/** Consecutive quiet time required before the main thread counts as idle. */
const IDLE_FOR_MS = 100;
const POLL_EVERY_MS = 32;
const IDLE_TIMEOUT_MS = 5000;
/** Task time below which a poll counts as no work: what the polling itself runs. */
const TASK_EPSILON_MS = 0.5;

/**
 * Resolves once the main thread's activity counters stop advancing for `IDLE_FOR_MS`. It waits out
 * trailing work that a paint or frame signal would miss: passive effects, deferred draws.
 */
async function waitForMainThreadIdle(cdp: BenchmarkCdp): Promise<void> {
  const start = performance.now();
  const poll = async () => {
    const metrics = await getPerformanceMetrics(cdp);
    return {
      taskMs: mainThreadTaskMs(metrics),
      layoutCount: metricValue(metrics, 'LayoutCount'),
      styleCount: metricValue(metrics, 'RecalcStyleCount'),
    };
  };

  let previous = await poll();
  let stableSince = performance.now();
  while (performance.now() - start < IDLE_TIMEOUT_MS) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_EVERY_MS);
    });
    // eslint-disable-next-line no-await-in-loop
    const current = await poll();
    const busy =
      current.taskMs - previous.taskMs > TASK_EPSILON_MS ||
      current.layoutCount !== previous.layoutCount ||
      current.styleCount !== previous.styleCount;
    previous = current;
    if (busy) {
      stableSince = performance.now();
    } else if (performance.now() - stableSince >= IDLE_FOR_MS) {
      return;
    }
  }
}

/**
 * The main-thread task time `interaction` costs, in milliseconds: everything the thread runs from
 * when it starts until the thread falls idle again, trailing work included. Waits for an idle thread
 * first, so that earlier work, such as the mount, isn't billed, and warms the CPU up after that wait
 * when the pages warm up, so that the interaction doesn't start on an idled core.
 *
 * Records nothing itself: record the result through a `ScalarMetric`.
 */
export async function measureMainThreadTask(
  { cdp }: { cdp: BenchmarkCdp },
  interaction: () => Promise<void> | void,
): Promise<number> {
  await waitForMainThreadIdle(cdp);
  // Before the first reading: the spinning ends the task the reading is taken after.
  warmUpCpu();
  const before = mainThreadTaskMs(await getPerformanceMetrics(cdp));
  await interaction();
  await waitForMainThreadIdle(cdp);
  const after = mainThreadTaskMs(await getPerformanceMetrics(cdp));
  return after - before;
}

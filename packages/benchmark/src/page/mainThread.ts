import type { BenchmarkCdp } from '../cdp';
import { warmUpCpu } from './warmUpCpu';

// What the main thread did over a stretch of a benchmark, read from Chromium's activity counters over
// the DevTools Protocol (`Performance.getMetrics`). It counts the work of code that draws outside
// React as well, which render durations don't see, so it compares any two implementations of the
// same interaction.

interface PerformanceMetric {
  name: string;
  value: number;
}

// Per page, which is loaded afresh every round. The domain itself stays on in the tab's DevTools
// session once a page has enabled it, so a later page only sends the command again.
let performanceDomainEnabled = false;

/** The counters read: task time, which is measured, and the counts that tell an idle thread. */
interface Counters {
  taskMs: number;
  layoutCount: number;
  styleCount: number;
}

/**
 * A counter a measurement is computed from. A missing one throws rather than reading as 0, which
 * would make every interaction look free: a broken benchmark would read as an excellent score.
 */
function requiredMetricValue(metrics: PerformanceMetric[], name: string): number {
  const metric = metrics.find((entry) => entry.name === name);
  if (metric === undefined) {
    throw new Error(
      `Chromium reported no "${name}" performance counter, so the main thread can't be ` +
        "measured. Check the DevTools Protocol's Performance domain against this Chromium version.",
    );
  }
  return metric.value;
}

async function readCounters(cdp: BenchmarkCdp): Promise<Counters> {
  if (!performanceDomainEnabled) {
    await cdp.send('Performance.enable');
    performanceDomainEnabled = true;
  }
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: PerformanceMetric[];
  };
  const value = (name: string) => requiredMetricValue(metrics, name);
  // Durations are reported in seconds.
  return {
    // Every task, whatever its kind, less the renderer's own DevTools command handling, so reading
    // the counters doesn't bill itself. `TaskDuration` rather than a sum of script, layout and style
    // time: rendering that none of those counters names is real work, and code that draws outside
    // React does much of its work there.
    taskMs: (value('TaskDuration') - value('DevToolsCommandDuration')) * 1000,
    layoutCount: value('LayoutCount'),
    styleCount: value('RecalcStyleCount'),
  };
}

/** Consecutive quiet time required before the main thread counts as idle. */
const IDLE_FOR_MS = 100;
const POLL_EVERY_MS = 32;
const IDLE_TIMEOUT_MS = 5000;
/** Task time below which a poll counts as no work: what the polling itself runs. */
const TASK_EPSILON_MS = 0.5;

/**
 * Resolves once the main thread's activity counters stop advancing for `IDLE_FOR_MS`. It waits out
 * trailing work that a paint or frame signal would miss: passive effects, deferred draws. Throws when
 * the thread never goes quiet, such as under an endless animation: a measurement taken then would
 * count unrelated work, or miss trailing work still running. Resolves with its last reading, taken
 * on the idle thread.
 */
async function waitForMainThreadIdle(cdp: BenchmarkCdp): Promise<Counters> {
  const start = performance.now();
  let previous = await readCounters(cdp);
  let stableSince = performance.now();
  let lastActivity = '';
  while (performance.now() - start < IDLE_TIMEOUT_MS) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_EVERY_MS);
    });
    // eslint-disable-next-line no-await-in-loop
    const current = await readCounters(cdp);
    let activity = '';
    if (current.taskMs - previous.taskMs > TASK_EPSILON_MS) {
      activity = 'task time';
    } else if (current.layoutCount !== previous.layoutCount) {
      activity = 'layout count';
    } else if (current.styleCount !== previous.styleCount) {
      activity = 'style recalculation count';
    }
    previous = current;
    if (activity) {
      lastActivity = activity;
      stableSince = performance.now();
    } else if (performance.now() - stableSince >= IDLE_FOR_MS) {
      return current;
    }
  }
  throw new Error(
    `The main thread never went idle for ${IDLE_FOR_MS}ms within ${IDLE_TIMEOUT_MS}ms: its ` +
      `${lastActivity} kept advancing. Something keeps running, such as an endless animation or a ` +
      'timer, so a measurement would include unrelated work. Stop it in the benchmark.',
  );
}

/** What the main thread did between `mainThreadTime()` and `mainThreadTimeEnd()`. */
export interface MainThreadMeasurement {
  /** Main-thread task time, in milliseconds: every task, whatever its kind. */
  taskMs: number;
}

/** The window `mainThreadTime()` opened, until `mainThreadTimeEnd()` closes it. */
let openWindow: { counters: Counters; openedAt: string } | null = null;

/**
 * Starts measuring what the main thread does, until `mainThreadTimeEnd()`. Waits for an idle thread
 * first, so that earlier work, such as the mount, isn't counted, and warms the CPU up after that
 * wait when the pages warm up, so that what follows doesn't start on an idled core.
 *
 * One window at a time: a second one would run its own wait and warm-up inside the first.
 */
export async function mainThreadTime({ cdp }: { cdp: BenchmarkCdp }): Promise<void> {
  if (openWindow) {
    throw new Error(
      'mainThreadTime() was called while a window is already open: its wait for an idle thread ' +
        'and its CPU warm-up would land inside the open window. Close it with ' +
        `mainThreadTimeEnd() first. The open window started at:\n${openWindow.openedAt}`,
    );
  }
  const openedAt = new Error().stack?.split('\n').slice(2).join('\n') ?? '(unknown)';
  await waitForMainThreadIdle(cdp);
  // A reading of its own, after the warm-up: the spinning ends the task the reading is taken after.
  warmUpCpu();
  const counters = await readCounters(cdp);
  openWindow = { counters, openedAt };
}

/**
 * Stops the window `mainThreadTime()` started and returns what the main thread did in it. Waits for
 * the thread to fall idle first, so that trailing work, such as deferred renders, is counted.
 *
 * Records nothing itself: record what it returns through a `ScalarMetric` or `DiscreteMetric`.
 */
export async function mainThreadTimeEnd({
  cdp,
}: {
  cdp: BenchmarkCdp;
}): Promise<MainThreadMeasurement> {
  const window = openWindow;
  if (!window) {
    throw new Error('mainThreadTimeEnd() was called without a matching mainThreadTime().');
  }
  openWindow = null;
  const after = await waitForMainThreadIdle(cdp);
  return { taskMs: after.taskMs - window.counters.taskMs };
}

/**
 * Closes a window a sample left open, and says where it was opened; `undefined` when none was.
 * The harness calls it after every sample, so that a forgotten window fails the sample it was
 * forgotten in rather than the next.
 */
export function discardOpenWindow(): string | undefined {
  if (!openWindow) {
    return undefined;
  }
  const { openedAt } = openWindow;
  openWindow = null;
  return openedAt;
}

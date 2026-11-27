import {
  benchmark,
  DiscreteMetric,
  mainThreadTime,
  mainThreadTimeEnd,
  ScalarMetric,
} from '@mui/internal-benchmark/page';
import type { BenchmarkContext } from '@mui/internal-benchmark/page';
import { SMOKE_SAMPLING } from '../_shared/sampling';

/**
 * Self-checks of `mainThreadTime()` / `mainThreadTimeEnd()`, the main-thread task time that
 * comparisons between charting libraries rest on. These are tests, not benchmarks: each case measures
 * work of a known size and throws when the measurement is wrong, and a case that throws fails the run,
 * so the benchmark job fails on the pull request that broke it. Their numbers aren't worth tracking.
 *
 * They run as benchmarks because what they check only exists in a real run: the runner's bridge to
 * the DevTools Protocol (`context.cdp`), a real Chromium, and its activity counters. A unit test, or
 * Vitest's browser mode, talks to the page another way and would pass however the bridge behaves.
 *
 * What each case guards:
 *
 * - **Work right after `mainThreadTime()`.** The runner hands a DevTools Protocol result back to the
 *   page through a DevTools command, and Chromium bills code that runs inside that command to
 *   `DevToolsCommandDuration`, which task time leaves out. So unless `context.cdp.send()` resumes in
 *   a task of its own, work that a benchmark does right after an awaited call (`mainThreadTime()`
 *   ends with one) goes uncounted: 50ms of work measured as under 1ms before that was fixed.
 * - **Work in a later task.** The ordinary case, which must keep reading its full length.
 * - **A second window.** It would run its wait for an idle thread inside the first one, so
 *   `mainThreadTime()` must reject it.
 *
 * A failure here means comparisons measured with these functions can't be trusted until it's fixed.
 */

const BUSY_MS = 50;
/** What `BUSY_MS` of work may measure as, at the least, on a loaded machine. */
const AT_LEAST_MS = 40;

const taskTime = new ScalarMetric({
  name: 'accounting:task',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});
const overlapRejected = new DiscreteMetric({ name: 'accounting:overlap-rejected' });

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Spin: main-thread work of a known length.
  }
}

async function measureBusy(context: BenchmarkContext, before: () => Promise<void>) {
  await mainThreadTime(context);
  await before();
  busy(BUSY_MS);
  const { taskMs } = await mainThreadTimeEnd(context);
  if (taskMs < AT_LEAST_MS) {
    throw new Error(
      `${BUSY_MS}ms of main-thread work measured as ${taskMs.toFixed(2)}ms of task time: the ` +
        'window misses work it should count.',
    );
  }
  taskTime.record(taskMs);
}

benchmark(
  'Self-check · work right after mainThreadTime()',
  (context) => measureBusy(context, async () => {}),
  SMOKE_SAMPLING,
);

benchmark(
  'Self-check · work in a later task',
  (context) =>
    measureBusy(
      context,
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 0);
        }),
    ),
  SMOKE_SAMPLING,
);

benchmark(
  'Self-check · a second window is rejected',
  async (context) => {
    await mainThreadTime(context);
    let rejected = false;
    try {
      await mainThreadTime(context);
    } catch {
      rejected = true;
    } finally {
      await mainThreadTimeEnd(context);
    }
    if (!rejected) {
      throw new Error('A second mainThreadTime() was accepted while a window was open.');
    }
    overlapRejected.record(1);
  },
  SMOKE_SAMPLING,
);

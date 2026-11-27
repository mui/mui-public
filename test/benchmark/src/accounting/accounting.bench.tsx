import { benchmark, ScalarMetric } from '@mui/internal-benchmark/page';
import type { BenchmarkContext } from '@mui/internal-benchmark/page';
import { SMOKE_SAMPLING } from '../_shared/sampling';

/**
 * Self-checks of main-thread task time read over the DevTools Protocol, which comparisons between
 * charting libraries rest on. These are tests, not benchmarks: each case measures work of a known
 * size and throws when the measurement is wrong, and a case that throws fails the run, so the
 * benchmark job fails on the pull request that broke it. Their numbers aren't worth tracking.
 *
 * They run as benchmarks because what they check only exists in a real run: the runner's bridge to
 * the DevTools Protocol (`context.cdp`), a real Chromium, and its activity counters. A unit test, or
 * Vitest's browser mode, talks to the page another way and would pass however the bridge behaves.
 *
 * What each case guards:
 *
 * - **Work right after an awaited `context.cdp.send()`.** The runner hands a result back to the page
 *   through a DevTools command, and Chromium bills code that runs inside that command to
 *   `DevToolsCommandDuration`, which task time leaves out. So unless `send()` resumes in a task of
 *   its own, work a benchmark does right after an awaited call goes uncounted: 50ms of work measured
 *   as 0.4ms before that was fixed.
 * - **Work in a later task.** The ordinary case, which must keep reading its full length.
 *
 * A failure here means task time measured over `context.cdp` can't be trusted until it's fixed.
 */

const BUSY_MS = 50;
/** What `BUSY_MS` of work may measure as, at the least, on a loaded machine. */
const AT_LEAST_MS = 40;

const taskTime = new ScalarMetric({
  name: 'accounting:task',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});

/** Main-thread task time since page load, less the renderer's own DevTools command handling. */
async function readTaskMs({ cdp }: BenchmarkContext): Promise<number> {
  await cdp.send('Performance.enable');
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: Array<{ name: string; value: number }>;
  };
  const value = (name: string) => metrics.find((metric) => metric.name === name)!.value;
  return (value('TaskDuration') - value('DevToolsCommandDuration')) * 1000;
}

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Spin: main-thread work of a known length.
  }
}

async function measureBusy(context: BenchmarkContext, before: () => Promise<void>) {
  const start = await readTaskMs(context);
  await before();
  busy(BUSY_MS);
  const taskMs = (await readTaskMs(context)) - start;
  if (taskMs < AT_LEAST_MS) {
    throw new Error(
      `${BUSY_MS}ms of main-thread work measured as ${taskMs.toFixed(2)}ms of task time: the ` +
        'measurement misses work it should count.',
    );
  }
  taskTime.record(taskMs);
}

benchmark(
  'Self-check · work right after an awaited CDP call',
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

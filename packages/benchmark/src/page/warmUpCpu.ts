// The CPU warm-up the harness runs before what it times; "Warming the CPU up" in the README says why.
// Only the harness calls it, right where its timing starts (before a case's `run`, and in
// `mainThreadTime()` after its wait for an idle thread), so that the spinning can never land inside a
// measurement.
import { benchmarkTrackDetail } from './trace';

/**
 * How long to spin. 50ms was measured not to be enough: benchmarks still read 3–13% slower than after
 * 200ms. Speedometer 3 spins before each timed step the same way (`warmupBeforeSync`).
 */
const WARMUP_MS = 200;

const enabled = process.env.BENCHMARK_CPU_WARMUP === 'true';

/** Spins the CPU for `WARMUP_MS`, unless the pages were built with the warm-up off. */
export function warmUpCpu(): void {
  if (!enabled) {
    return;
  }
  const start = performance.now();
  const end = start + WARMUP_MS;
  while (performance.now() < end) {
    // Spin.
  }
  performance.measure('warm-up', { start, end, detail: benchmarkTrackDetail('tertiary') });
}

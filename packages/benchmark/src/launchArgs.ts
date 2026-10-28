// Shared by every runner. `--expose-gc` lets the harness force GC between iterations; the
// backgrounding flags stop Chrome throttling the benchmark tab.
export const BENCHMARK_LAUNCH_ARGS = [
  '--js-flags=--expose-gc',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/** The viewport every runner measures at. */
export const BENCHMARK_VIEWPORT = { width: 1920, height: 1080 };

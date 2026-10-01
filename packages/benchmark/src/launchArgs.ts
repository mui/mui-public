// Shared by every runner. `--expose-gc` lets the harness force GC between iterations; the
// backgrounding flags stop Chrome throttling the benchmark tab.
export const BENCHMARK_LAUNCH_ARGS = [
  // EXPERIMENT: BENCHMARK_EXTRA_JS_FLAGS appends V8 flags.
  `--js-flags=--expose-gc ${process.env.BENCHMARK_EXTRA_JS_FLAGS ?? ''}`.trim(),
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/** The viewport every runner measures at. */
export const BENCHMARK_VIEWPORT = { width: 1920, height: 1080 };

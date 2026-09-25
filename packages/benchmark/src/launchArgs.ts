// Chromium/V8 launch args shared by every runner, kept intentionally minimal. `--expose-gc` is
// required: the harness forces GC between iterations for clean, comparable timings. The
// backgrounding flags stop Chrome from throttling the (headless or occluded) benchmark tab, which
// would otherwise add large variance. Heavier "determinism" flags (`--no-opt`, `--predictable`,
// `--hash-seed`/`--random-seed`, `--disable-gpu`, `--enable-benchmarking`) were measured to slow
// renders ~40% and distort paint timing without reducing variance, so they are omitted — add them
// per project if a specific workload needs them.
export const BENCHMARK_LAUNCH_ARGS = [
  '--js-flags=--expose-gc',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

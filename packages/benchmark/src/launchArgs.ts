// Shared by every runner. `--expose-gc` lets the harness force GC between iterations; the
// backgrounding flags stop Chrome throttling the benchmark tab.
export const BENCHMARK_LAUNCH_ARGS = [
  '--js-flags=--expose-gc',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const JS_FLAGS = '--js-flags=';

/**
 * The launch flags, `base` followed by a caller's `extra`. Chromium keeps only the last
 * `--js-flags`, so a caller's V8 flags would silently drop `--expose-gc`, and with it the forced
 * GC between iterations: every `--js-flags` value is joined into one instead.
 */
export function withLaunchArgs(
  extra: readonly string[],
  base: readonly string[] = BENCHMARK_LAUNCH_ARGS,
): string[] {
  const all = [...base, ...extra];
  const jsFlags = all.filter((arg) => arg.startsWith(JS_FLAGS));
  const rest = all.filter((arg) => !arg.startsWith(JS_FLAGS));
  if (jsFlags.length === 0) {
    return rest;
  }
  return [`${JS_FLAGS}${jsFlags.map((arg) => arg.slice(JS_FLAGS.length)).join(' ')}`, ...rest];
}

/** The viewport every runner measures at. */
export const BENCHMARK_VIEWPORT = { width: 1920, height: 1080 };

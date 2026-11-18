/**
 * Whether the benchmarks run React's profiling build.
 *
 * - `true` (the default): `react-dom/profiling`, the only build that reports render durations through
 *   `React.Profiler`. It also bills a few microseconds to every component render, so it slows down
 *   code that renders through React and not code that draws outside it.
 * - `false`: `react-dom/client`'s production build, what users ship. Render durations are not
 *   reported; paint and custom metrics are. Use it to compare with libraries that draw outside React.
 */
const ENV_VALUES: Record<string, boolean> = { true: true, '1': true, false: false, '0': false };

/** The option when given, then `BENCHMARK_REACT_PROFILING`, then `true`. */
export function resolveReactProfiling(option?: boolean): boolean {
  if (option !== undefined) {
    return option;
  }
  const value = process.env.BENCHMARK_REACT_PROFILING;
  if (value === undefined || value === '') {
    return true;
  }
  if (!(value in ENV_VALUES)) {
    throw new Error(
      `Unknown BENCHMARK_REACT_PROFILING value "${value}". Benchmarks would run a React build ` +
        'nobody asked for. Set it to one of: true, false, 1, 0.',
    );
  }
  return ENV_VALUES[value];
}

/**
 * The vite config that selects the React build: the case runtime imports `react-dom/client`,
 * aliased to the profiling build when profiling, and reads the choice from
 * `process.env.BENCHMARK_REACT_PROFILING`.
 */
export function reactProfilingConfig(profiling: boolean) {
  return {
    alias: profiling ? [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }] : [],
    define: { 'process.env.BENCHMARK_REACT_PROFILING': JSON.stringify(String(profiling)) },
  };
}

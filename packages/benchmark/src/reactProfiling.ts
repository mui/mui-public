/**
 * Whether the benchmarks run React's profiling build.
 *
 * - `true` (the default): `react-dom/profiling`, the only build that reports render durations through
 *   `React.Profiler`. It also bills a few microseconds to every component render, so it slows down
 *   code that renders through React and not code that draws outside it.
 * - `false`: `react-dom/client`'s production build, what users ship. Render durations are not
 *   reported; paint and custom metrics are. Use it to compare with libraries that draw outside React.
 */
import { resolveBooleanSetting } from './booleanSetting';

/** The option when given, then `BENCHMARK_REACT_PROFILING`, then `true`. */
export function resolveReactProfiling(option?: boolean): boolean {
  return resolveBooleanSetting(
    'BENCHMARK_REACT_PROFILING',
    option,
    true,
    'Benchmarks would run a React build nobody asked for.',
  );
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

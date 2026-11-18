/**
 * Which build of React the benchmarks run.
 *
 * - `'profiling'` (the default): `react-dom/profiling`, the only build that reports render durations
 *   through `React.Profiler`. It also bills a few microseconds to every component render, so it
 *   slows down code that renders through React and not code that draws outside it.
 * - `'production'`: `react-dom/client`, what users ship. Render durations are not reported; paint and
 *   custom metrics are. Use it to compare with libraries that draw outside React.
 */
export type ReactBuild = 'profiling' | 'production';

const REACT_BUILDS: readonly ReactBuild[] = ['profiling', 'production'];

/** The option when given, then `BENCHMARK_REACT_BUILD`, then `'profiling'`. */
export function resolveReactBuild(option?: ReactBuild): ReactBuild {
  const value = option ?? process.env.BENCHMARK_REACT_BUILD ?? 'profiling';
  if (!REACT_BUILDS.includes(value as ReactBuild)) {
    throw new Error(
      `Unknown React build "${value}". Benchmarks would run a build nobody asked for. ` +
        `Set \`reactBuild\` or BENCHMARK_REACT_BUILD to one of: ${REACT_BUILDS.join(', ')}.`,
    );
  }
  return value as ReactBuild;
}

/**
 * The vite config that selects `build`: the case runtime imports `react-dom/client`, aliased to the
 * profiling build when profiling, and reads the build from `process.env.BENCHMARK_REACT_BUILD`.
 */
export function reactBuildConfig(build: ReactBuild) {
  return {
    alias:
      build === 'profiling'
        ? [{ find: 'react-dom/client', replacement: 'react-dom/profiling' }]
        : [],
    define: { 'process.env.BENCHMARK_REACT_BUILD': JSON.stringify(build) },
  };
}

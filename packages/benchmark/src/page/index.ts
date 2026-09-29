// `@mui/internal-benchmark/page`: what a benchmark file for `benchmark run` imports.

export * from '../publicApi';
export { benchmark, compare, markPageReady } from './page';
export type { BenchmarkContext, BenchmarkRun, BenchPage } from './page';
export { reactBenchmark } from './reactBenchmark';
export type { ReactBenchmarkOptions } from './reactBenchmark';

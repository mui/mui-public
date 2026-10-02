// `@mui/internal-benchmark/page`: what a benchmark file for `benchmark run` imports.

export * from '../publicApi';
export { benchmark, compare, markPageReady } from './page';
export type { BenchmarkCase, BenchmarkContext, BenchmarkRun, BenchPage } from './page';
export { reactBenchmark } from './reactBenchmark';
export type { ReactBenchmarkOptions } from './reactBenchmark';
export type { SamplingOptions } from '../sampling';

// `@mui/internal-benchmark/page`: what a benchmark file for the `benchmark` CLI imports.

export * from '../publicApi';
export { benchmark, compare, markPageReady } from './page';
export type {
  BenchmarkCase,
  BenchmarkCaseOptions,
  BenchmarkContext,
  BenchmarkRun,
  BenchPage,
} from './page';
export { mainThreadTime, mainThreadTimeEnd } from './mainThread';
export type { MainThreadMeasurement } from './mainThread';
export { reactBenchmark } from './reactBenchmark';
export type { ReactBenchmarkOptions } from './reactBenchmark';
export type { SamplingOptions } from '../sampling';

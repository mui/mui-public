// What both runtimes export: the Vitest harness (`@mui/internal-benchmark`) and the page runtime
// the `benchmark` CLI measures (`@mui/internal-benchmark/page`). Each entry adds its own case API.

export type { RenderEvent, IterationData, InteractionContext } from './types';
export type {
  MetricKind,
  MetricDirection,
  MetricAlarm,
  MetricConfig,
  MetricDefinition,
} from './types';
export type { BenchmarkInput } from './input';
export type { BenchmarkInteraction } from './caseRuntime';
export { ElementTiming } from './ElementTiming';
export { Metric, type MetricRecordOptions } from './metricCore';
export { ScalarMetric } from './ScalarMetric';
export { DiscreteMetric } from './DiscreteMetric';

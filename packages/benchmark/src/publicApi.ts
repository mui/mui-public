// What `@mui/internal-benchmark` exports whichever runtime it resolves to — the Vitest harness
// (`index.tsx`) or the page runtime (`page/page.tsx`) — so a benchmark file type-checks and runs the
// same against both. Each entry adds its own `benchmark`, `compare` and, for Vitest, `runCase`.

export type { RenderEvent, IterationData, InteractionContext } from './types';
export type {
  MetricKind,
  MetricDirection,
  MetricAlarm,
  MetricConfig,
  MetricDefinition,
} from './types';
export type { BenchmarkInput } from './input';
export type { BenchmarkInteraction, BenchmarkOptions, VariantLoader } from './caseRuntime';
export { ElementTiming } from './ElementTiming';
export { Metric, type MetricRecordOptions } from './metricCore';
export { ScalarMetric } from './ScalarMetric';
export { DiscreteMetric } from './DiscreteMetric';

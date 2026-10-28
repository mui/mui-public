/// <reference types="vitest" />

import type { IterationData, MetricReport } from './types';

declare module 'vitest' {
  interface TaskMeta {
    benchmarkName?: string;
    benchmarkIterations?: IterationData[];
    /** Custom metrics recorded via `ScalarMetric`/`DiscreteMetric`, keyed by metric name. */
    benchmarkMetrics?: Record<string, MetricReport>;
  }
}

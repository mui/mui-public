import type { MetricConfig, MetricKind } from './types';

export interface MetricRecordOptions {
  /** Sub-series label. Recorded under `${name}#${id}` in the report; omit for the base series. */
  id?: string;
}

/**
 * Where recorded values go. The runtime a benchmark runs under installs one: the Vitest harness
 * accumulates them per running test, the A/B page emits them as `performance.measure` entries.
 */
export type MetricRecorder = (
  metric: Metric,
  value: number,
  options: MetricRecordOptions | undefined,
) => void;

let recorder: MetricRecorder = (metric) => {
  throw new Error(
    `${metric.constructor.name}.record() was called outside a benchmark runtime. Import metrics from ` +
      '`@mui/internal-benchmark` inside a benchmark file.',
  );
};

export function setMetricRecorder(next: MetricRecorder): void {
  recorder = next;
}

/**
 * Base class for custom benchmark metrics. Use `ScalarMetric` or `DiscreteMetric`.
 *
 * A single instance can be declared at module scope and reused across tests and loop iterations,
 * inside or outside React; the active runtime decides which test or sample a value belongs to.
 */
export abstract class Metric {
  abstract readonly kind: MetricKind;

  readonly name: string;

  readonly config: MetricConfig;

  constructor(config: MetricConfig | string) {
    this.config = typeof config === 'string' ? { name: config } : config;
    this.name = this.config.name;
    if (this.name.includes('#')) {
      throw new Error(
        `Metric name "${this.name}" must not contain "#" — it is reserved as the sub-series separator.`,
      );
    }
  }

  /**
   * Records a single measured value. Pass `options.id` to split into a labeled sub-series.
   */
  record(value: number, options?: MetricRecordOptions): void {
    recorder(this, value, options);
  }
}

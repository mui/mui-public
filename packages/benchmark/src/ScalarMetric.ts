import { Metric } from './Metric';
import type { MetricKind } from './types';

/**
 * A continuous measurement (timings, sizes, …). Samples are aggregated with mean ± standard
 * deviation and IQR outlier removal, and compared against a baseline with a relative noise band.
 *
 * Besides `record()`, it offers a `console.time`-style timing helper:
 *
 * ```ts
 * const metric = new ScalarMetric({ name: 'render', format: { style: 'unit', unit: 'millisecond' } });
 * metric.time();
 * doWork();
 * metric.timeEnd(); // records the elapsed milliseconds
 * ```
 */
export class ScalarMetric extends Metric {
  readonly kind: MetricKind = 'scalar';

  private readonly pending = new Map<string, number>();

  /** Starts a timer. Pass a `label` to time a sub-series; it maps to `record`'s `id`. */
  time(label?: string): void {
    const key = label ?? '';
    if (this.pending.has(key)) {
      throw new Error(
        `${this.name}.time(${label ? `\"${label}\"` : ''}) was called while a timer is already running for that label.`,
      );
    }
    this.pending.set(key, performance.now());
  }

  /** Stops the timer started by `time(label)` and records the elapsed milliseconds. */
  timeEnd(label?: string): void {
    const key = label ?? '';
    const start = this.pending.get(key);
    if (start === undefined) {
      throw new Error(
        `${this.name}.timeEnd(${label ? `"${label}"` : ''}) was called without a matching time().`,
      );
    }
    this.pending.delete(key);
    this.record(performance.now() - start, label !== undefined ? { id: label } : undefined);
  }
}

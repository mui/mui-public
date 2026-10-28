import { Metric } from './metricCore';
import type { MetricConfig, MetricKind } from './types';

/**
 * A discrete count of events or occurrences, whose alarm bands are absolute count deltas.
 * Formatted as a whole number by default.
 *
 * ```ts
 * const clicks = new DiscreteMetric({ name: 'button_clicks' });
 * clicks.record(countClicks());
 * ```
 */
export class DiscreteMetric extends Metric {
  readonly kind: MetricKind = 'discrete';

  constructor(config: MetricConfig | string) {
    const resolved = typeof config === 'string' ? { name: config } : config;
    super({ ...resolved, format: resolved.format ?? { maximumFractionDigits: 0 } });
  }
}

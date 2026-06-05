export interface RenderEvent {
  id: string;
  /**
   * The React Profiler phase that triggered the render.
   * - `mount` — first render of the component
   * - `update` — re-render caused by state, props, or context change
   * - `nested-update` — re-render caused by a state update inside useLayoutEffect or flushSync
   *
   * See https://react.dev/reference/react/Profiler#onrender-callback
   */
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  /** Start time in milliseconds (from performance.now()) */
  startTime: number;
}

export interface BenchmarkMetric {
  /** Metric name, e.g. "paint:bench", "paint:grid-header" */
  name: string;
  /** Measured value in ms */
  value: number;
}

export interface IterationData {
  renders: RenderEvent[];
  metrics: BenchmarkMetric[];
}

export interface InteractionContext {
  /**
   * Wait for an element with the given `elementtiming` identifier to be painted.
   * @param identifier - The `elementtiming` attribute value to wait for.
   * @param timeout - Timeout in ms. Default: 5000. Pass 0 or Infinity to rely on the test timeout.
   */
  waitForElementTiming: (identifier: string, timeout?: number) => Promise<void>;
}

/**
 * Whether a custom metric measures a continuous value or a discrete count.
 * - `scalar` — continuous measurements (timings, sizes); compared with a relative noise band.
 * - `discrete` — counts/events; compared as exact integers.
 */
export type MetricKind = 'scalar' | 'discrete';

/** Which direction of change counts as a regression for a metric in alarm mode. */
export type MetricDirection = 'lowerIsBetter' | 'higherIsBetter';

export interface MetricAlarm {
  /** Defaults to `lowerIsBetter`. */
  direction?: MetricDirection;
  /**
   * Relative noise band (e.g. `0.1` = 10%) beyond which a change is flagged as a regression.
   * Scalar metrics only — discrete metrics compare exactly and ignore this.
   */
  threshold?: number;
}

export interface MetricConfig {
  name: string;
  /** Display formatting applied by the reporter and dashboard via `Intl.NumberFormat`. */
  format?: Intl.NumberFormatOptions;
  /**
   * Regression judgment. Its presence opts the metric into alarming; when omitted the metric
   * is informational (the diff is shown but never flagged).
   */
  alarm?: MetricAlarm;
}

/** Aggregated stats for a single metric sub-series, as they cross the browser→runner boundary. */
export interface MetricSampleStats {
  mean: number;
  stdDev: number;
  outliers: number;
  /** Number of recorded samples (used to derive iteration counts; stripped from the report). */
  count: number;
}

/** A custom metric's aggregated data attached to `task.meta`, keyed by metric name. */
export interface MetricReport {
  kind: MetricKind;
  config: MetricConfig;
  /** Aggregated stats keyed by sub-series id (`''` is the base series). */
  series: Record<string, MetricSampleStats>;
}

/** Per-metric configuration hoisted to the top level of the report (keyed by metric name). */
export interface MetricDefinition {
  kind: MetricKind;
  format?: Intl.NumberFormatOptions;
  alarm?: MetricAlarm;
  /** Reserved for the future render/paint migration; unused today. */
  group?: string;
}

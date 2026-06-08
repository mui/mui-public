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

export interface IterationData {
  renders: RenderEvent[];
}

export interface InteractionContext {
  /**
   * Wait for an element with the given `elementtiming` identifier to be painted.
   * @param identifier - The `elementtiming` attribute value to wait for.
   * @param timeout - Timeout in ms. Default: 5000. Pass 0 or Infinity to rely on the test timeout.
   */
  waitForElementTiming: (identifier: string, timeout?: number) => Promise<void>;
  /**
   * Pause recording of the harness's React render/paint measurements. Custom metrics keep
   * recording. Throws if recording is already paused.
   */
  pauseReactRecording: () => void;
  /**
   * Resume recording of the harness's React render/paint measurements. Throws if recording is
   * already active.
   */
  resumeReactRecording: () => void;
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
   * Softer band: a regression past `warn` (but within `error`) is flagged as a warning.
   * Scalar metrics: a relative fraction (`0.1` = 10%). Discrete metrics: an absolute count delta.
   */
  warn?: number;
  /**
   * Harder band: a regression past `error` is flagged as an error (the alarm). When **both**
   * `warn` and `error` are omitted, `error` defaults to the dashboard's global noise band; with
   * only `warn` set there is no error band (warning-only).
   * Scalar metrics: a relative fraction (`0.25` = 25%). Discrete metrics: an absolute count delta.
   */
  error?: number;
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
}

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

export interface WaitForElementTimingOptions {
  /** Timeout in ms. Default: 5000. Pass 0 or Infinity to rely on the test timeout. */
  timeout?: number;
}

export interface InteractionContext {
  waitForElementTiming: (
    identifier: string,
    options?: WaitForElementTimingOptions,
  ) => Promise<void>;
}

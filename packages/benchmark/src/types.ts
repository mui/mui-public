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

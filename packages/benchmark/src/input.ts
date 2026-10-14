/** Sends a raw Chrome DevTools Protocol command to the page under test. */
export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface ScrollGestureOptions {
  /** Viewport x coordinate (CSS pixels) where the gesture starts. */
  x: number;
  /** Viewport y coordinate (CSS pixels) where the gesture starts. */
  y: number;
  /** Horizontal distance to scroll, positive to scroll right. */
  deltaX?: number;
  /** Vertical distance to scroll, positive to scroll down (like a wheel's `deltaY`). */
  deltaY?: number;
  /** Gesture speed in pixels per second. Defaults to the browser's 800. */
  speed?: number;
}

/**
 * Trusted input for interactions. Each gesture is one command: the browser generates the whole
 * event sequence itself at frame cadence, so the round trip to the driver is paid once per gesture,
 * not once per event, and the page sees the event timing a real mouse or trackpad would produce.
 */
export interface BenchmarkInput {
  scroll: (options: ScrollGestureOptions) => Promise<void>;
}

/**
 * The Chrome DevTools Protocol, on the session that drives the page under test: for what a case
 * sets up or reads itself — CPU throttling (`Emulation.setCPUThrottlingRate`), the engine's own
 * counters (`Performance.getMetrics`) as custom metrics.
 *
 * A setting changed this way stays on the tab, through later samples and the other cases sampled in
 * it — those of a `compare()` too — so a case that changes one sets it every time, and the others
 * set it as they need it.
 */
export interface BenchmarkCdp {
  send: CdpSend;
}

export function createInput(send: CdpSend): BenchmarkInput {
  return {
    scroll: async ({ x, y, deltaX = 0, deltaY = 0, speed }) => {
      // CDP distances point the other way: positive `yDistance` scrolls up.
      await send('Input.synthesizeScrollGesture', {
        x,
        y,
        xDistance: -deltaX,
        yDistance: -deltaY,
        speed,
        gestureSourceType: 'mouse',
      });
    },
  };
}

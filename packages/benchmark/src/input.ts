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

export interface PinchGestureOptions {
  x: number;
  y: number;
  /** Relative scale at the end of the pinch: `> 1` zooms in, `< 1` zooms out. */
  scaleFactor: number;
  /** Relative pointer speed in pixels per second. Defaults to the browser's 800. */
  relativeSpeed?: number;
}

export interface TapGestureOptions {
  x: number;
  y: number;
}

/**
 * Trusted input for interactions. Each gesture is one command: the browser generates the whole
 * event sequence itself at frame cadence, so the round trip to the driver is paid once per gesture,
 * not once per event, and the page sees the event timing a real mouse or trackpad would produce.
 */
export interface BenchmarkInput {
  scroll: (options: ScrollGestureOptions) => Promise<void>;
  pinch: (options: PinchGestureOptions) => Promise<void>;
  tap: (options: TapGestureOptions) => Promise<void>;
  /** Escape hatch for any other CDP command. */
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
    pinch: async ({ x, y, scaleFactor, relativeSpeed }) => {
      await send('Input.synthesizePinchGesture', {
        x,
        y,
        scaleFactor,
        relativeSpeed,
        gestureSourceType: 'mouse',
      });
    },
    tap: async ({ x, y }) => {
      await send('Input.synthesizeTapGesture', { x, y, gestureSourceType: 'mouse' });
    },
    send,
  };
}

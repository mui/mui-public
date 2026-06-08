export interface ReactRecordingControls {
  /** Whether React render/paint recording is active right now — the synchronous gate for renders. */
  readonly active: boolean;
  /** Whether any active recording window closed without capturing a render. */
  readonly hadEmptyActiveWindow: boolean;
  /**
   * Whether recording was active at `time` (a `performance.now()` timestamp). Paint entries are
   * observed asynchronously, so they are attributed by their `renderTime` rather than by the
   * recording state at the moment the observer callback happens to fire.
   */
  activeAt(time: number): boolean;
  /** Note that a render was captured in the current window. Called by the harness from `onRender`. */
  markRendered(): void;
  /** Close the final window at the end of the iteration (validates it if recording is still active). */
  finalizeWindow(): void;
  /** Pause React render/paint recording. Throws if recording is already paused. */
  pauseReactRecording(): void;
  /** Resume React render/paint recording. Throws if recording is already active. */
  resumeReactRecording(): void;
}

/**
 * Creates the per-iteration switch that turns the harness's React render/paint recording on and
 * off. The interaction callback drives it via `pauseReactRecording`/`resumeReactRecording`; the
 * strict state machine (each throws when called in the wrong state) catches unbalanced pairs early.
 *
 * It also tracks whether each *active* window captured at least one render, so the harness can flag
 * a window that was recording but measured nothing — while leaving fully-paused (metric-only)
 * benchmarks alone.
 */
export function createReactRecordingControls(initiallyActive: boolean): ReactRecordingControls {
  let active = initiallyActive;
  let currentWindowHasRender = false;
  let emptyActiveWindow = false;
  // Transitions in chronological order. The implicit state before the first toggle is
  // `initiallyActive`; `activeAt` replays this to attribute a paint to its render time.
  const transitions: { time: number; active: boolean }[] = [];

  // Flag the window being closed if it was recording yet captured nothing.
  function closeWindowIfActive() {
    if (active && !currentWindowHasRender) {
      emptyActiveWindow = true;
    }
  }

  return {
    get active() {
      return active;
    },
    get hadEmptyActiveWindow() {
      return emptyActiveWindow;
    },
    activeAt(time) {
      let result = initiallyActive;
      for (const transition of transitions) {
        if (transition.time > time) {
          break;
        }
        result = transition.active;
      }
      return result;
    },
    markRendered() {
      currentWindowHasRender = true;
    },
    finalizeWindow() {
      closeWindowIfActive();
    },
    pauseReactRecording() {
      if (!active) {
        throw new Error('pauseReactRecording() called but React recording is already paused.');
      }
      closeWindowIfActive();
      active = false;
      transitions.push({ time: performance.now(), active: false });
    },
    resumeReactRecording() {
      if (active) {
        throw new Error('resumeReactRecording() called but React recording is already active.');
      }
      active = true;
      currentWindowHasRender = false;
      transitions.push({ time: performance.now(), active: true });
    },
  };
}

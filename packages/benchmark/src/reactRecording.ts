export interface ReactRecordingControls {
  /** Whether React render/paint recording is active right now — the synchronous gate for renders. */
  readonly active: boolean;
  /**
   * Whether recording was active at `time` (a `performance.now()` timestamp). Paint entries are
   * observed asynchronously, so they are attributed by their `renderTime` rather than by the
   * recording state at the moment the observer callback happens to fire.
   */
  activeAt(time: number): boolean;
  /** Pause React render/paint recording. Throws if recording is already paused. */
  pauseReactRecording(): void;
  /** Resume React render/paint recording. Throws if recording is already active. */
  resumeReactRecording(): void;
}

/**
 * Creates the per-iteration switch that turns the harness's React render/paint recording on and
 * off. The interaction callback drives it via `pauseReactRecording`/`resumeReactRecording`; the
 * strict state machine (each throws when called in the wrong state) catches unbalanced pairs early.
 */
export function createReactRecordingControls(initiallyActive: boolean): ReactRecordingControls {
  let active = initiallyActive;
  // Transitions in chronological order. The implicit state before the first toggle is
  // `initiallyActive`; `activeAt` replays this to attribute a paint to its render time.
  const transitions: { time: number; active: boolean }[] = [];

  return {
    get active() {
      return active;
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
    pauseReactRecording() {
      if (!active) {
        throw new Error('pauseReactRecording() called but React recording is already paused.');
      }
      active = false;
      transitions.push({ time: performance.now(), active: false });
    },
    resumeReactRecording() {
      if (active) {
        throw new Error('resumeReactRecording() called but React recording is already active.');
      }
      active = true;
      transitions.push({ time: performance.now(), active: true });
    },
  };
}

import { describe, it, expect } from 'vitest';
import { createReactRecordingControls } from './reactRecording';

describe('createReactRecordingControls', () => {
  it('starts in the requested state', () => {
    expect(createReactRecordingControls(true).active).toBe(true);
    expect(createReactRecordingControls(false).active).toBe(false);
  });

  it('pauses and resumes', () => {
    const controls = createReactRecordingControls(true);
    controls.pauseReactRecording();
    expect(controls.active).toBe(false);
    controls.resumeReactRecording();
    expect(controls.active).toBe(true);
  });

  it('throws when pausing while already paused', () => {
    const controls = createReactRecordingControls(false);
    expect(() => controls.pauseReactRecording()).toThrow(/already paused/);
  });

  it('throws when resuming while already active', () => {
    const controls = createReactRecordingControls(true);
    expect(() => controls.resumeReactRecording()).toThrow(/already active/);
  });

  it('attributes times before all toggles to the initial state and after to the current', () => {
    const controls = createReactRecordingControls(false);
    controls.resumeReactRecording();
    expect(controls.activeAt(-Infinity)).toBe(false);
    expect(controls.activeAt(Infinity)).toBe(true);
  });
});

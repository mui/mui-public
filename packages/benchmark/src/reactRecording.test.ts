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

describe('createReactRecordingControls active-window render check', () => {
  it('does not flag a window that captured a render before pause', () => {
    const controls = createReactRecordingControls(true);
    controls.markRendered();
    controls.pauseReactRecording();
    expect(controls.hadEmptyActiveWindow).toBe(false);
  });

  it('flags an active window paused without any render', () => {
    const controls = createReactRecordingControls(true);
    controls.pauseReactRecording();
    expect(controls.hadEmptyActiveWindow).toBe(true);
  });

  it('flags the final window via finalizeWindow when active and empty', () => {
    const controls = createReactRecordingControls(true);
    controls.finalizeWindow();
    expect(controls.hadEmptyActiveWindow).toBe(true);
  });

  it('does not flag the final window when it captured a render', () => {
    const controls = createReactRecordingControls(true);
    controls.markRendered();
    controls.finalizeWindow();
    expect(controls.hadEmptyActiveWindow).toBe(false);
  });

  it('does not flag anything when recording was never active', () => {
    const controls = createReactRecordingControls(false);
    controls.finalizeWindow();
    expect(controls.hadEmptyActiveWindow).toBe(false);
  });

  it('resets render presence per window', () => {
    const controls = createReactRecordingControls(true);
    controls.markRendered();
    controls.pauseReactRecording(); // first window had a render
    controls.resumeReactRecording(); // second window starts empty
    controls.finalizeWindow();
    expect(controls.hadEmptyActiveWindow).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import type { RunnerTestCase } from 'vitest';
import { metricsGate } from './metricsGate';

// The gate keys on test identity via a WeakSet, so any object stands in for a RunnerTestCase.
function fakeTest(): RunnerTestCase {
  return {} as RunnerTestCase;
}

describe('metricsGate', () => {
  it('is enabled by default for an unseen test', () => {
    expect(metricsGate.isRecordingEnabled(fakeTest())).toBe(true);
  });

  it('disables and re-enables recording for a test', () => {
    const test = fakeTest();
    metricsGate.setRecordingEnabled(test, false);
    expect(metricsGate.isRecordingEnabled(test)).toBe(false);
    metricsGate.setRecordingEnabled(test, true);
    expect(metricsGate.isRecordingEnabled(test)).toBe(true);
  });

  it('keeps the state independent per test', () => {
    const suppressed = fakeTest();
    const recording = fakeTest();
    metricsGate.setRecordingEnabled(suppressed, false);
    expect(metricsGate.isRecordingEnabled(suppressed)).toBe(false);
    expect(metricsGate.isRecordingEnabled(recording)).toBe(true);
  });
});

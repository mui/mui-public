import type { RunnerTestCase } from 'vitest';

// Internal — not exported from the package, not user-facing. The `benchmark()` harness toggles
// recording per test (off during warmup iterations) and `Metric.record()` consults it, so custom
// metrics recorded inside a benchmark honor the same warmup exclusion as renders and `bench:paint`.
//
// Storage tracks the *disabled* tests so absence means enabled: a test with no entry — e.g. a
// standalone `it()` loop that never goes through the harness — records normally by default.
const disabled = new WeakSet<RunnerTestCase>();

export const metricsGate = {
  /** Whether custom-metric recording is currently enabled for `test`. Defaults to `true`. */
  isRecordingEnabled(test: RunnerTestCase): boolean {
    return !disabled.has(test);
  },
  /** Enable or disable custom-metric recording for `test`. */
  setRecordingEnabled(test: RunnerTestCase, enabled: boolean): void {
    if (enabled) {
      disabled.delete(test);
    } else {
      disabled.add(test);
    }
  },
};

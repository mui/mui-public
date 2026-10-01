import { afterAll, expect, it, vi } from 'vitest';

afterAll(() => {
  // This runs after setupVitest's fallback and restores the clock before the next file.
  try {
    /* eslint-disable vitest/no-standalone-expect -- Verify state after all test-finished callbacks. */
    expect(vi.isFakeTimers()).to.equal(true);
    expect(vi.getTimerCount()).to.equal(1);
    /* eslint-enable vitest/no-standalone-expect */
  } finally {
    vi.useRealTimers();
  }
});

it('preserves timers created by a later cleanup callback', ({ onTestFinished }) => {
  expect(vi.isFakeTimers()).to.equal(false);

  onTestFinished(() => {
    vi.useFakeTimers();
    setTimeout(() => {}, 0);
  });
});

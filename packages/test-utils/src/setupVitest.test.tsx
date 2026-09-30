import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, screen } from './createRenderer';
import setupVitest from './setupVitest';

describe('setupVitest', () => {
  setupVitest();

  const { render } = createRenderer();

  const itWithFixture = it.extend<{ teardownChecks: void }>({
    teardownChecks: [
      // eslint-disable-next-line no-empty-pattern -- Vitest requires destructuring for fixtures.
      async ({}, use) => {
        await use(undefined);

        expect(vi.isFakeTimers()).to.equal(false);
        expect(screen.queryByTestId('fixture')).to.equal(null);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      },
      { auto: true },
    ],
  });

  itWithFixture('cleans up before asynchronous fixture teardown', () => {
    vi.useFakeTimers();
    render(<div data-testid="fixture" />);
    expect(vi.isFakeTimers()).to.equal(true);
  });

  describe('cleanup callbacks', () => {
    beforeEach(() => {
      return () => {
        expect(vi.isFakeTimers()).to.equal(false);
        expect(screen.queryByTestId('callback')).to.equal(null);
      };
    });

    it('cleans up before returned beforeEach and test-finished callbacks', ({ onTestFinished }) => {
      onTestFinished(() => {
        expect(vi.isFakeTimers()).to.equal(false);
        expect(screen.queryByTestId('callback')).to.equal(null);
      });

      vi.useFakeTimers();
      render(<div data-testid="callback" />);
    });
  });

  it('cleans up after attempts that fail the console check', { retry: 2 }, ({ task }) => {
    expect(screen.queryByTestId('leaked')).to.equal(null);
    expect(vi.isFakeTimers()).to.equal(false);

    // The first two attempts fail the console check. Each retry must start with a clean state.
    if (task.result?.retryCount !== 2) {
      vi.useFakeTimers();
      render(<div data-testid="leaked" />);
      console.error('Unexpected error');
    }
  });
});

describe('setupVitest fallback', () => {
  beforeEach(({ onTestFinished }) => {
    onTestFinished(() => {
      try {
        /* eslint-disable vitest/no-standalone-expect -- This callback runs after setupVitest's fallback. */
        expect(vi.isFakeTimers()).to.equal(true);
        expect(vi.getTimerCount()).to.equal(1);
        /* eslint-enable vitest/no-standalone-expect */
      } finally {
        vi.useRealTimers();
      }
    });
  });

  setupVitest();

  it('preserves timers created by a later cleanup callback', ({ onTestFinished }) => {
    expect(vi.isFakeTimers()).to.equal(false);

    onTestFinished(() => {
      vi.useFakeTimers();
      setTimeout(() => {}, 0);
    });
  });
});

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, screen } from '../../src/createRenderer';

describe('setupVitest cleanup order', () => {
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
});

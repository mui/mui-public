import * as React from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRenderer, screen } from '../../src/createRenderer';

describe('setupVitest flush errors', () => {
  const { render } = createRenderer();
  const cleanAttempts: number[] = [];

  afterAll(() => {
    // eslint-disable-next-line vitest/no-standalone-expect -- Verify all attempts after retries finish.
    expect(cleanAttempts).to.deep.equal([0, 1]);
  });

  it('cleans up after a timer throws during the teardown flush', { retry: 1 }, ({ task }) => {
    expect(screen.queryByTestId('leaked')).to.equal(null);
    expect(vi.isFakeTimers()).to.equal(false);
    cleanAttempts.push(task.result?.retryCount ?? 0);

    // The first attempt fails in the teardown flush. The retry must start with a clean state.
    if (task.result?.retryCount === 0) {
      vi.useFakeTimers();
      render(<div data-testid="leaked" />);
      setTimeout(() => {
        throw new Error('Timer error');
      });
    }
  });
});

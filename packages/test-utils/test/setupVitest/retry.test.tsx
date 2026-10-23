import * as React from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createRenderer, screen } from '../../src/createRenderer';

describe('setupVitest retries', () => {
  const { render } = createRenderer();
  const cleanAttempts: number[] = [];

  // A later successful retry must not hide an earlier attempt that started with leaked state.
  afterAll(() => {
    // eslint-disable-next-line vitest/no-standalone-expect -- Verify all attempts after retries finish.
    expect(cleanAttempts).to.deep.equal([0, 1, 2]);
  });

  it('cleans up after attempts that fail the console check', { retry: 2 }, ({ task }) => {
    expect(screen.queryByTestId('leaked')).to.equal(null);
    expect(vi.isFakeTimers()).to.equal(false);
    cleanAttempts.push(task.result?.retryCount ?? 0);

    // The first two attempts fail the console check. Each retry must start with a clean state.
    if (task.result?.retryCount !== 2) {
      vi.useFakeTimers();
      render(<div data-testid="leaked" />);
      console.error('Unexpected error');
    }
  });
});

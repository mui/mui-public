import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRenderer, screen } from './createRenderer';
import setupVitest from './setupVitest';

describe('setupVitest', () => {
  setupVitest();

  const { render } = createRenderer();

  it('cleans up after an attempt that fails the console check', { retry: 1 }, ({ task }) => {
    expect(screen.queryByTestId('leaked')).to.equal(null);
    expect(vi.isFakeTimers()).to.equal(false);

    // The first attempt fails the console check. The retry must start with a clean state.
    if (task.result?.retryCount === 0) {
      vi.useFakeTimers();
      render(<div data-testid="leaked" />);
      console.error('Unexpected error');
    }
  });
});

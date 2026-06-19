/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) {
    throw new Error('kaboom');
  }
  return <div data-testid="ok">ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when they do not throw', () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
  });

  it('catches a thrown error, reports it, and renders the fallback', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary onError={onError} fallback={<div data-testid="fallback">failed</div>}>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('fallback')).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('kaboom');
    consoleError.mockRestore();
  });

  it('recovers and renders children again when resetKeys change', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKeys={['v1']}>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(screen.queryByTestId('ok')).toBeNull();

    // Same key -> stays errored even though the child would now render.
    rerender(
      <ErrorBoundary resetKeys={['v1']}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByTestId('ok')).toBeNull();

    // Changed key -> error clears and children render again.
    rerender(
      <ErrorBoundary resetKeys={['v2']}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
    consoleError.mockRestore();
  });
});

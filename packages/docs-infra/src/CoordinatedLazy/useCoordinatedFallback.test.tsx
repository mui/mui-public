/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useCoordinatedFallback } from './useCoordinatedFallback';
import { CoordinatedFallbackContext } from './CoordinatedFallbackContext';
import type { CoordinatedFallbackContextValue } from './types';

function Harness({ hoistData }: { hoistData?: Record<string, unknown> }) {
  const { data, isNested } = useCoordinatedFallback(hoistData);
  return <div data-testid="out">{JSON.stringify({ data: data ?? null, isNested })}</div>;
}

describe('useCoordinatedFallback', () => {
  it('hoists each entry, signals onReady, and returns the context data + isNested', () => {
    const hoist = vi.fn();
    const onReady = vi.fn();
    const value: CoordinatedFallbackContextValue = {
      hoist,
      onReady,
      isNested: true,
      data: { parentKey: 'parentValue' },
    };

    render(
      <CoordinatedFallbackContext.Provider value={value}>
        <Harness hoistData={{ dictionary: 'HELLO' }} />
      </CoordinatedFallbackContext.Provider>,
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(hoist).toHaveBeenCalledWith('dictionary', 'HELLO');
    expect(screen.getByTestId('out').textContent).toContain('"isNested":true');
    expect(screen.getByTestId('out').textContent).toContain('"parentKey":"parentValue"');
  });

  it('is inert and reports not-nested outside a CoordinatedLazy', () => {
    render(<Harness />);
    expect(screen.getByTestId('out').textContent).toContain('"isNested":false');
    expect(screen.getByTestId('out').textContent).toContain('"data":null');
  });
});

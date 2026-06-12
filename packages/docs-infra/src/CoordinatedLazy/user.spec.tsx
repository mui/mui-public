/**
 * @vitest-environment jsdom
 *
 * Integration tests for `CoordinatedLazy` - the generic fallback<->content swap.
 * These read as the documented user-facing behaviors; unit edge cases live in
 * `useCoordinatedSwap.test.tsx` / `useCoordinatedFallback.test.tsx`.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { CoordinatedLazy } from './CoordinatedLazy';
import { useCoordinatedFallback } from './useCoordinatedFallback';
import { useCoordinatedContent } from './CoordinatedContentContext';
import { createSettleGate } from '../useCoordinated/createSettleGate';

afterEach(cleanup);

function Loading() {
  return <div data-testid="loading">loading</div>;
}
function Content() {
  return <div data-testid="content">content</div>;
}

describe('CoordinatedLazy', () => {
  it('shows the fallback until ready, then swaps to the content', async () => {
    const gate = createSettleGate();
    const { rerender } = render(
      <CoordinatedLazy ready={false} gate={gate} fallback={<Loading />} content={<Content />} />,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();

    rerender(<CoordinatedLazy ready gate={gate} fallback={<Loading />} content={<Content />} />);
    expect(await screen.findByTestId('content')).toBeTruthy();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('renders the content directly when there is no fallback', () => {
    const gate = createSettleGate();
    render(<CoordinatedLazy ready gate={gate} content={<Content />} />);
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('force-mounts the fallback once (even when ready) so it can hoist data the content reads', async () => {
    function LoadingHoist() {
      // Memoize so the hoist effect fires once with a stable map.
      useCoordinatedFallback(React.useMemo(() => ({ dictionary: 'HELLO' }), []));
      return <div data-testid="loading">loading</div>;
    }
    function ContentReads() {
      const hoisted = useCoordinatedContent();
      return <div data-testid="content">{String(hoisted.dictionary)}</div>;
    }

    const gate = createSettleGate();
    // `ready` is true from the very first render, yet the fallback still mounts
    // once so its hoist runs and the content can consume the hoisted value.
    render(
      <CoordinatedLazy ready gate={gate} fallback={<LoadingHoist />} content={<ContentReads />} />,
    );

    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('HELLO');
  });

  it('suppresses a nested swap while the outer instance is still showing its fallback', async () => {
    const gate = createSettleGate();
    // The inner CoordinatedLazy lives inside the outer's fallback. The inner is
    // ready, but must stay in its own fallback until the outer swaps - avoiding
    // a "fallback -> content -> fallback -> content" flicker.
    render(
      <CoordinatedLazy
        ready={false}
        gate={gate}
        content={<div data-testid="outer-content">outer</div>}
        fallback={
          <CoordinatedLazy
            ready
            gate={gate}
            fallback={<div data-testid="inner-fallback">inner-loading</div>}
            content={<div data-testid="inner-content">inner-content</div>}
          />
        }
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('inner-fallback')).toBeTruthy();
    expect(screen.queryByTestId('inner-content')).toBeNull();
  });

  it('holds the swap while deferring even when ready', () => {
    const gate = createSettleGate();
    render(
      <CoordinatedLazy ready defer gate={gate} fallback={<Loading />} content={<Content />} />,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();
  });
});

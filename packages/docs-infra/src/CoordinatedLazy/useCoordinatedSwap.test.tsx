/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoordinatedSwap } from './useCoordinatedSwap';
import { createSettleGate } from '../useCoordinated/createSettleGate';

/** Flush the gate's deferred settle-check microtask, inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useCoordinatedSwap', () => {
  it('shows content immediately when there is no fallback', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: true, hasFallback: false, gate }),
    );
    expect(result.current.showFallback).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('holds the fallback while not ready', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: false, hasFallback: true, gate }),
    );
    expect(result.current.showFallback).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(gate.isSettled()).toBe(false);
  });

  it('swaps to content once ready (after the force-mount-once commit)', async () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: true, hasFallback: true, gate }),
    );
    // renderHook flushes the force-mount effect and the resulting re-render.
    expect(result.current.showFallback).toBe(false);
    await flush();
    expect(gate.isSettled()).toBe(true);
  });

  it('skips the fallback entirely when skipFallback is set', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: false, hasFallback: true, skipFallback: true, gate }),
    );
    expect(result.current.showFallback).toBe(false);
  });

  it('holds the swap while deferring even when ready', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: true, defer: true, hasFallback: true, gate }),
    );
    expect(result.current.showFallback).toBe(true);
  });

  it('with requireHoist, holds the swap until the fallback hoists', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: true, hasFallback: true, requireHoist: true, gate }),
    );
    expect(result.current.showFallback).toBe(true); // no hoist yet

    act(() => {
      result.current.fallbackContext.hoist!('dictionary', 'abc');
    });
    expect(result.current.showFallback).toBe(false);
  });

  it('accumulates hoisted values', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: false, hasFallback: true, gate }),
    );
    act(() => {
      result.current.fallbackContext.hoist!('a', 1);
      result.current.fallbackContext.hoist!('b', 2);
    });
    expect(result.current.hoisted).toEqual({ a: 1, b: 2 });
  });

  it('fires preload with the hoisted data so helpers can load in parallel', () => {
    const gate = createSettleGate();
    const preload = vi.fn();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: false, hasFallback: true, gate, preload }),
    );
    expect(preload).not.toHaveBeenCalled(); // nothing hoisted yet

    act(() => {
      result.current.fallbackContext.hoist!('transforms', ['focus']);
    });
    expect(preload).toHaveBeenCalledWith({ transforms: ['focus'] });
  });

  it('holdGate keeps the gate open while the content stays rendered', async () => {
    const gate = createSettleGate();
    const { result, rerender } = renderHook(
      ({ hold }: { hold: boolean }) =>
        useCoordinatedSwap({ ready: true, hasFallback: true, holdGate: hold, gate }),
      { initialProps: { hold: true } },
    );
    // Content is shown (the swap committed), not the fallback...
    expect(result.current.showFallback).toBe(false);
    await flush();
    // ...but the gate stays held while holdGate is set (content finishing
    // deferred work in place).
    expect(gate.isSettled()).toBe(false);

    rerender({ hold: false });
    await flush();
    expect(gate.isSettled()).toBe(true);
  });

  it('exposes a consumer-callable hoist that populates the hoisted map', () => {
    const gate = createSettleGate();
    const { result } = renderHook(() =>
      useCoordinatedSwap({ ready: false, hasFallback: true, gate }),
    );
    // Hoist from the consumer (not the fallback subtree) - e.g. a client-loaded
    // data path with no fallback mounted.
    act(() => {
      result.current.hoist('dictionary', 'abc');
    });
    expect(result.current.hoisted).toEqual({ dictionary: 'abc' });
  });
});

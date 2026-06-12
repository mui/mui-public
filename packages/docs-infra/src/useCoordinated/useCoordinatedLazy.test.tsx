/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoordinatedLazy } from './useCoordinatedLazy';
import { layoutShiftsSettled, resetLayoutShiftGate } from './layoutShiftGate';

afterEach(() => {
  resetLayoutShiftGate();
});

/** Drain the microtask the gate uses to defer its settle check. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useCoordinatedLazy', () => {
  it('registers on mount and holds the gate until it settles', async () => {
    const { rerender } = renderHook(({ settled }) => useCoordinatedLazy(settled), {
      initialProps: { settled: false },
    });

    // Registered but not yet settled → the gate is held.
    expect(layoutShiftsSettled()).toBe(false);

    rerender({ settled: true });
    await flush();
    expect(layoutShiftsSettled()).toBe(true);
  });

  it('releases its registration when it unmounts before settling', async () => {
    const { unmount } = renderHook(() => useCoordinatedLazy(false));
    expect(layoutShiftsSettled()).toBe(false);

    // A block that unmounts mid-swap must not hold the gate open for the page.
    unmount();
    await flush();
    expect(layoutShiftsSettled()).toBe(true);
  });

  it('releases idempotently across the settled effect and unmount', async () => {
    // A second source keeps the gate held so we can observe whether the first
    // source's release double-counts.
    const { unmount: unmountSecond } = renderHook(() => useCoordinatedLazy(false));
    const { rerender: rerenderFirst, unmount: unmountFirst } = renderHook(
      ({ settled }) => useCoordinatedLazy(settled),
      { initialProps: { settled: false } },
    );

    rerenderFirst({ settled: true }); // settle via the effect
    await flush();
    unmountFirst(); // unmount after settle — the release must be a no-op
    await flush();

    // If the first source had released twice, the pending count would have gone
    // negative and the gate would wrongly report settled while the second is
    // still pending.
    expect(layoutShiftsSettled()).toBe(false);
    unmountSecond();
  });
});

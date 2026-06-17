/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettleGate } from './useSettleGate';
import { createSettleGate } from './createSettleGate';

/** Flush the microtask the gate uses to defer its settle check, inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSettleGate', () => {
  it('holds the given gate until `settled` flips true', async () => {
    const gate = createSettleGate();
    const { rerender } = renderHook(({ settled }) => useSettleGate(settled, gate), {
      initialProps: { settled: false },
    });

    expect(gate.isSettled()).toBe(false);

    rerender({ settled: true });
    await flush();
    expect(gate.isSettled()).toBe(true);
  });

  it('releases its registration on unmount before settling', async () => {
    const gate = createSettleGate();
    const { unmount } = renderHook(() => useSettleGate(false, gate));
    expect(gate.isSettled()).toBe(false);

    // A component that unmounts mid-swap must not hold the gate open.
    unmount();
    await flush();
    expect(gate.isSettled()).toBe(true);
  });

  it('does not double-release across the settled flip and unmount', async () => {
    // A second source keeps the gate held so a double-release on the first
    // would wrongly open it.
    const gate = createSettleGate();
    renderHook(() => useSettleGate(false, gate)); // second source, stays pending
    const { rerender, unmount } = renderHook(({ settled }) => useSettleGate(settled, gate), {
      initialProps: { settled: false },
    });

    rerender({ settled: true }); // settle via the effect
    await flush();
    unmount(); // release again — must be a no-op
    await flush();

    expect(gate.isSettled()).toBe(false); // the second source is still pending
  });

  it('is a no-op when the gate is null', async () => {
    const gate = createSettleGate();
    // A null gate must not register anywhere; the real gate stays unarmed.
    renderHook(() => useSettleGate(false, null));
    await flush();
    expect(gate.isSettled()).toBe(true); // unrelated gate untouched (unarmed)
  });
});

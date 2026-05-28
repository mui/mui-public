/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransitionPhase } from './useTransitionPhase';

describe('useTransitionPhase', () => {
  it('starts not-ready for any window key', () => {
    const { result } = renderHook(() => useTransitionPhase('a|b|0'));

    expect(result.current.ready).toBe(false);
  });

  it('flips ready=true after notify() for the current window key', () => {
    const { result } = renderHook(() => useTransitionPhase('a|b|0'));

    expect(result.current.ready).toBe(false);

    act(() => {
      result.current.notify();
    });

    expect(result.current.ready).toBe(true);
  });

  it('resets ready=false automatically when the window key changes', () => {
    const { result, rerender } = renderHook(
      ({ windowKey }: { windowKey: string }) => useTransitionPhase(windowKey),
      { initialProps: { windowKey: 'a|b|0' } },
    );

    act(() => {
      result.current.notify();
    });
    expect(result.current.ready).toBe(true);

    // A new swap window opens — readiness must fall back without an
    // explicit reset call.
    rerender({ windowKey: 'b|c|0' });
    expect(result.current.ready).toBe(false);
  });

  it('does not auto-restore ready when an earlier window key returns', () => {
    const { result, rerender } = renderHook(
      ({ windowKey }: { windowKey: string }) => useTransitionPhase(windowKey),
      { initialProps: { windowKey: 'a|b|0' } },
    );

    act(() => {
      result.current.notify();
    });
    expect(result.current.ready).toBe(true);

    rerender({ windowKey: 'b|c|0' });
    expect(result.current.ready).toBe(false);

    // Coming back to a previously-notified key must NOT resurrect
    // the stale ready flag — each window is a fresh wait. The hook
    // resets via a guarded `setState` during render so a recycled
    // key value still starts at not-ready.
    rerender({ windowKey: 'a|b|0' });
    expect(result.current.ready).toBe(false);
  });

  it('notify() targets the current key, not the key at render time of the previous call', () => {
    const { result, rerender } = renderHook(
      ({ windowKey }: { windowKey: string }) => useTransitionPhase(windowKey),
      { initialProps: { windowKey: 'a|b|0' } },
    );

    rerender({ windowKey: 'b|c|0' });

    act(() => {
      result.current.notify();
    });

    // Notify after the rerender must mark the *new* window ready.
    expect(result.current.ready).toBe(true);

    rerender({ windowKey: 'a|b|0' });
    expect(result.current.ready).toBe(false);

    // Each window is a fresh wait — returning to `'b|c|0'` does
    // NOT resurrect the earlier notify; the consumer must call
    // `notify()` again for the new window instantiation.
    rerender({ windowKey: 'b|c|0' });
    expect(result.current.ready).toBe(false);
  });

  it('keeps the notify identity stable while the window key is stable', () => {
    const { result, rerender } = renderHook(
      ({ windowKey }: { windowKey: string }) => useTransitionPhase(windowKey),
      { initialProps: { windowKey: 'a|b|0' } },
    );

    const firstNotify = result.current.notify;
    rerender({ windowKey: 'a|b|0' });
    expect(result.current.notify).toBe(firstNotify);

    rerender({ windowKey: 'b|c|0' });
    expect(result.current.notify).not.toBe(firstNotify);
  });

  it('notify() called repeatedly for the same key is idempotent', () => {
    const { result } = renderHook(() => useTransitionPhase('a|b|0'));

    act(() => {
      result.current.notify();
      result.current.notify();
      result.current.notify();
    });

    expect(result.current.ready).toBe(true);
  });
});

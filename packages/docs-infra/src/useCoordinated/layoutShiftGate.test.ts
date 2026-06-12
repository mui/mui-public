import { describe, it, expect, vi } from 'vitest';
import {
  registerLayoutShiftSource,
  whenLayoutShiftsSettled,
  layoutShiftsSettled,
  resetLayoutShiftGate,
} from './layoutShiftGate';

/** Flush the microtask the gate uses to defer its settle check. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('layoutShiftGate', () => {
  it('is settled when nothing has registered', () => {
    resetLayoutShiftGate();
    expect(layoutShiftsSettled()).toBe(true);
    // No wait needed — fast path returns null (mirrors useHighlightGate).
    expect(whenLayoutShiftsSettled()).toBeNull();
  });

  it('holds until the only registered source settles', async () => {
    resetLayoutShiftGate();
    const settle = registerLayoutShiftSource();

    expect(layoutShiftsSettled()).toBe(false);
    const wait = whenLayoutShiftsSettled();
    expect(wait).toBeInstanceOf(Promise);

    let resolved = false;
    wait!.then(() => {
      resolved = true;
    });

    settle();
    await flushMicrotasks();

    expect(layoutShiftsSettled()).toBe(true);
    expect(resolved).toBe(true);
  });

  it('settles only once every source has settled', async () => {
    resetLayoutShiftGate();
    const settleA = registerLayoutShiftSource();
    const settleB = registerLayoutShiftSource();

    settleA();
    await flushMicrotasks();
    expect(layoutShiftsSettled()).toBe(false);

    settleB();
    await flushMicrotasks();
    expect(layoutShiftsSettled()).toBe(true);
  });

  it('does not settle prematurely when a source resolves before a sibling registers', async () => {
    // Mirrors an `init` block that highlights and settles during the same
    // hydration commit in which a later block is still registering.
    resetLayoutShiftGate();
    const settleA = registerLayoutShiftSource();
    settleA(); // A done before B exists — count momentarily hits 0
    const settleB = registerLayoutShiftSource();

    await flushMicrotasks();
    // The deferred check ran after B registered, so the gate stays closed.
    expect(layoutShiftsSettled()).toBe(false);

    settleB();
    await flushMicrotasks();
    expect(layoutShiftsSettled()).toBe(true);
  });

  it('treats settle() as idempotent', async () => {
    resetLayoutShiftGate();
    const settleA = registerLayoutShiftSource();
    registerLayoutShiftSource(); // B, never settles

    settleA();
    settleA(); // double-settle must not over-decrement and open early
    await flushMicrotasks();

    expect(layoutShiftsSettled()).toBe(false);
  });

  it('does not re-close once the page has settled', async () => {
    resetLayoutShiftGate();
    const settle = registerLayoutShiftSource();
    settle();
    await flushMicrotasks();
    expect(layoutShiftsSettled()).toBe(true);

    // A block that mounts after the initial settle adopts the current value
    // rather than re-closing the gate for everyone.
    const lateSettle = registerLayoutShiftSource();
    expect(layoutShiftsSettled()).toBe(true);
    expect(whenLayoutShiftsSettled()).toBeNull();
    lateSettle();
    await flushMicrotasks();
    expect(layoutShiftsSettled()).toBe(true);
  });

  it('rejects an in-flight wait when its signal aborts', async () => {
    resetLayoutShiftGate();
    registerLayoutShiftSource();
    const controller = new AbortController();
    const wait = whenLayoutShiftsSettled(controller.signal);
    expect(wait).toBeInstanceOf(Promise);

    controller.abort();
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns a settled fast-path for an already-aborted signal only when unsettled', async () => {
    resetLayoutShiftGate();
    registerLayoutShiftSource();
    const controller = new AbortController();
    controller.abort();
    await expect(whenLayoutShiftsSettled(controller.signal)!).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('force-opens via the safety timeout when a source never settles', () => {
    vi.useFakeTimers();
    try {
      resetLayoutShiftGate();
      registerLayoutShiftSource(); // never settles (e.g. a swap that errored)
      expect(layoutShiftsSettled()).toBe(false);

      vi.advanceTimersByTime(10_000);
      expect(layoutShiftsSettled()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

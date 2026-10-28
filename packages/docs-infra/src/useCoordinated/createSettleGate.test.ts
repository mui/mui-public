import { describe, it, expect, vi } from 'vitest';
import { createSettleGate } from './createSettleGate';

/** Flush the microtask the gate uses to defer its settle check. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createSettleGate', () => {
  // Parity with the module-global `layoutShiftGate` it generalizes — each test
  // owns a fresh instance instead of sharing module state and calling reset().
  describe('settle lifecycle', () => {
    it('is settled when nothing has registered', () => {
      const gate = createSettleGate();
      expect(gate.isSettled()).toBe(true);
      // Fast path: already settled returns null instead of a Promise.
      expect(gate.whenSettled()).toBeNull();
    });

    it('holds until the only registered source settles', async () => {
      const gate = createSettleGate();
      const settle = gate.register();

      expect(gate.isSettled()).toBe(false);
      const wait = gate.whenSettled();
      expect(wait).toBeInstanceOf(Promise);

      let resolved = false;
      wait!.then(() => {
        resolved = true;
      });

      settle();
      await flushMicrotasks();

      expect(gate.isSettled()).toBe(true);
      expect(resolved).toBe(true);
    });

    it('settles only once every source has settled', async () => {
      const gate = createSettleGate();
      const settleA = gate.register();
      const settleB = gate.register();

      settleA();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false);

      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('does not settle prematurely when a source resolves before a sibling registers in the same tick', async () => {
      const gate = createSettleGate();
      const settleA = gate.register();
      settleA(); // A done before B exists — count momentarily hits 0
      const settleB = gate.register();

      await flushMicrotasks();
      // The deferred check ran after B registered, so the gate stays closed.
      expect(gate.isSettled()).toBe(false);

      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('treats settle() as idempotent', async () => {
      const gate = createSettleGate();
      const settleA = gate.register();
      gate.register(); // B, never settles

      settleA();
      settleA(); // double-settle must not over-decrement and open early
      await flushMicrotasks();

      expect(gate.isSettled()).toBe(false);
    });

    it('does not re-close once settled; a late registrant adopts the open state', async () => {
      const gate = createSettleGate();
      const settle = gate.register();
      settle();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);

      const lateSettle = gate.register();
      expect(gate.isSettled()).toBe(true);
      expect(gate.whenSettled()).toBeNull();
      lateSettle();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });
  });

  describe('abort handling', () => {
    it('rejects an in-flight wait when its signal aborts', async () => {
      const gate = createSettleGate();
      gate.register();
      const controller = new AbortController();
      const wait = gate.whenSettled(controller.signal);
      expect(wait).toBeInstanceOf(Promise);

      controller.abort();
      await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects immediately for an already-aborted signal while unsettled', async () => {
      const gate = createSettleGate();
      gate.register();
      const controller = new AbortController();
      controller.abort();
      await expect(gate.whenSettled(controller.signal)!).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('safety timeout', () => {
    it('force-opens via the default safety timeout when a source never settles', () => {
      vi.useFakeTimers();
      try {
        const gate = createSettleGate();
        gate.register(); // never settles (e.g. a swap that errored)
        expect(gate.isSettled()).toBe(false);

        vi.advanceTimersByTime(10_000);
        expect(gate.isSettled()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('honors a custom safetyTimeoutMs', () => {
      vi.useFakeTimers();
      try {
        const gate = createSettleGate({ safetyTimeoutMs: 2_000 });
        gate.register();
        vi.advanceTimersByTime(1_999);
        expect(gate.isSettled()).toBe(false);
        vi.advanceTimersByTime(1);
        expect(gate.isSettled()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('known-count completion (expect)', () => {
    it('stays closed during a lull until the expected count has registered', async () => {
      const gate = createSettleGate();
      gate.expect(2);

      const settleA = gate.register();
      settleA(); // pending 0, but only 1 of 2 has ever registered
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false);

      const settleB = gate.register();
      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('opens when the count is met regardless of expect/register order', async () => {
      const gate = createSettleGate();
      const settleA = gate.register();
      const settleB = gate.register();
      gate.expect(2); // declared after both registered
      settleA();
      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });
  });

  describe('last-chunk completion (markLast)', () => {
    it('holds an unknown-count stream open via expect(Infinity) until markLast opens it', async () => {
      const gate = createSettleGate();
      gate.expect(Number.POSITIVE_INFINITY); // streaming: unknown total, never auto-open

      const settleA = gate.register();
      settleA();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false); // held open: count never reaches Infinity

      const settleB = gate.register();
      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false); // still held

      gate.markLast(); // terminal: open regardless of the expected count
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('still waits for the last outstanding source after markLast', async () => {
      const gate = createSettleGate();
      gate.expect(Number.POSITIVE_INFINITY);
      const settleA = gate.register();
      const settleB = gate.register();
      settleA();
      gate.markLast(); // B is still pending
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false);

      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('overrides an unmet expect() count when the stream ends early', async () => {
      const gate = createSettleGate();
      gate.expect(5); // expected five...
      const settleA = gate.register();
      const settleB = gate.register();
      settleA();
      settleB();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false); // only 2 of 5 registered → held

      gate.markLast(); // ...but the stream ended at two
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });

    it('opens on pending zero after markLast even without any expect()', async () => {
      const gate = createSettleGate();
      gate.markLast(); // standalone: no expect() was ever called
      const settle = gate.register();
      settle();
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(true);
    });
  });

  describe('injected scheduler and reset', () => {
    it('uses an injected scheduleCheck instead of queueMicrotask', () => {
      const scheduled: Array<() => void> = [];
      const gate = createSettleGate({ scheduleCheck: (callback) => scheduled.push(callback) });

      const settle = gate.register();
      settle();
      expect(gate.isSettled()).toBe(false); // check not flushed yet

      scheduled.forEach((callback) => callback());
      expect(gate.isSettled()).toBe(true);
    });

    it('reset() returns the gate to its initial unarmed state', async () => {
      const gate = createSettleGate();
      gate.register(); // never settles
      await flushMicrotasks();
      expect(gate.isSettled()).toBe(false);

      gate.reset();
      expect(gate.isSettled()).toBe(true);
      expect(gate.whenSettled()).toBeNull();
    });
  });
});

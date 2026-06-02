/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerPeer,
  reportValue,
  announceTarget,
  hasEverAnnounced,
  getBarrierAnnounceTime,
} from './coordinatePreference';
import {
  resetCoordinatorsForTests,
  getCoordinatorStatsForTests,
} from './coordinatePreference.testUtils';
import {
  registerLayoutShiftSource,
  whenLayoutShiftsSettled,
  resetLayoutShiftGate,
} from './layoutShiftGate';

afterEach(() => {
  resetCoordinatorsForTests();
  resetLayoutShiftGate();
  vi.useRealTimers();
});

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('coordinatePreference', () => {
  describe('peer registration', () => {
    it('registers and unregisters peers', () => {
      const unregister = registerPeer('ch', 'peer-1');
      expect(getCoordinatorStatsForTests().totalPeers).toBe(1);
      unregister();
      expect(getCoordinatorStatsForTests().channelCount).toBe(0);
    });

    it('throws when registering the same peer id twice on a channel', () => {
      registerPeer('ch', 'dup');
      expect(() => registerPeer('ch', 'dup')).toThrow(/already registered/);
    });

    it('allows the same peer id on different channels', () => {
      const u1 = registerPeer('ch-a', 'shared');
      const u2 = registerPeer('ch-b', 'shared');
      expect(getCoordinatorStatsForTests().totalPeers).toBe(2);
      u1();
      u2();
    });

    it('unregister is idempotent', () => {
      const unregister = registerPeer('ch', 'p');
      unregister();
      expect(() => unregister()).not.toThrow();
    });
  });

  describe('lazy path', () => {
    it('runs preload then onCommit for a single peer', async () => {
      registerPeer<string>('ch', 'p1');
      const preload = vi.fn(async () => 'loaded');
      const onCommit = vi.fn();
      const handle = announceTarget('ch', 'p1', 'target', {
        causesLayoutShift: () => false,
        preload,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      await handle.settled;
      expect(preload).toHaveBeenCalledExactlyOnceWith('target', expect.any(AbortSignal));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('target', 'loaded');
    });

    it('a layout-shift-gated preload defers the commit until the page settles', async () => {
      // Mirrors how `useVariantSelection` / `useTransformManagement` compose the
      // page-wide layout-shift gate into their `preload`: a coordinated
      // layout-shifting commit must not land while another block is still
      // mid-swap, so the whole page updates as one.
      registerPeer<string>('ch', 'p1');
      // A sibling block has registered but hasn't finished its initial swap.
      const settleBlock = registerLayoutShiftSource();

      const onCommit = vi.fn();
      const handle = announceTarget('ch', 'p1', 'target', {
        causesLayoutShift: () => true,
        preload: (_target: string, signal: AbortSignal) =>
          whenLayoutShiftsSettled(signal) ?? Promise.resolve(),
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });

      await flushMicrotasks();
      // Gate still closed → preload pending → commit held.
      expect(onCommit).not.toHaveBeenCalled();

      // The last block finishes its swap → gate opens → commit lands.
      settleBlock();
      await handle.settled;
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('target', undefined);
    });

    it('self-serializes successive announcements on the same peer', async () => {
      registerPeer<number>('ch', 'p1');
      const order: string[] = [];
      const slowPreload = vi.fn(async (n: number) => {
        order.push(`preload-start-${n}`);
        await nextTick();
        order.push(`preload-end-${n}`);
        return n;
      });
      const onCommit = vi.fn((_t: number, p: number | undefined) => {
        order.push(`commit-${p}`);
      });
      const h1 = announceTarget('ch', 'p1', 1, {
        causesLayoutShift: () => false,
        preload: slowPreload,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      const h2 = announceTarget('ch', 'p1', 2, {
        causesLayoutShift: () => false,
        preload: slowPreload,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      await Promise.all([h1.settled, h2.settled]);
      expect(order).toEqual([
        'preload-start-1',
        'preload-end-1',
        'commit-1',
        'preload-start-2',
        'preload-end-2',
        'commit-2',
      ]);
    });

    it('runs different peers concurrently (no cross-peer serialization for the lazy path)', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const order: string[] = [];
      const make = (label: string) => async (target: string) => {
        order.push(`start-${label}-${target}`);
        await nextTick();
        order.push(`end-${label}-${target}`);
        return target;
      };
      const h1 = announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => false,
        preload: make('p1'),
        onCommit: () => {},
        isOriginator: false,
        announceTime: Date.now(),
      });
      const h2 = announceTarget('ch', 'p2', 'A', {
        causesLayoutShift: () => false,
        preload: make('p2'),
        onCommit: () => {},
        isOriginator: false,
        announceTime: Date.now(),
      });
      await Promise.all([h1.settled, h2.settled]);
      // Both should have started before either ended — concurrent
      const startedP1 = order.indexOf('start-p1-A');
      const startedP2 = order.indexOf('start-p2-A');
      const endedP1 = order.indexOf('end-p1-A');
      const endedP2 = order.indexOf('end-p2-A');
      expect(startedP1).toBeLessThan(endedP2);
      expect(startedP2).toBeLessThan(endedP1);
    });

    it('cancel aborts an unstarted lazy-path announcement', async () => {
      registerPeer<string>('ch', 'p1');
      const order: string[] = [];
      const slowPreload = async (t: string, signal: AbortSignal) => {
        order.push(`start-${t}`);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
        order.push(`end-${t}`);
        return t;
      };
      const onCommit = vi.fn();
      const h1 = announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => false,
        preload: slowPreload,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      const h2 = announceTarget('ch', 'p1', 'B', {
        causesLayoutShift: () => false,
        preload: slowPreload,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      h2.cancel();
      await h1.settled;
      await flushMicrotasks();
      expect(order).toEqual(['start-A', 'end-A']);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('A', 'A');
    });

    it('omitted preload still fires onCommit with undefined', async () => {
      registerPeer<string>('ch', 'p1');
      const onCommit = vi.fn();
      const handle = announceTarget('ch', 'p1', 'x', {
        causesLayoutShift: () => false,
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      await handle.settled;
      expect(onCommit).toHaveBeenCalledWith('x', undefined);
    });

    it('defers commit through requestIdleCallback by default', async () => {
      registerPeer<string>('ch', 'p1');
      const idleCallbacks: Array<() => void> = [];
      const originalRIC = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      const originalCIC = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
        idleCallbacks.push(cb);
        return idleCallbacks.length;
      };
      (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => {};
      try {
        const onCommit = vi.fn();
        announceTarget('ch', 'p1', 'x', {
          causesLayoutShift: () => false,
          preload: async () => 'loaded',
          onCommit,
          isOriginator: false,
          announceTime: Date.now(),
        });
        // Preload yields to the main thread via setTimeout(0), so a
        // macrotask flush is required before its result is observed.
        // Drain microtasks first so the preload's yield-setTimeout is
        // queued before `nextTick`'s own setTimeout.
        await flushMicrotasks();
        await nextTick();
        await flushMicrotasks();
        // Commit is queued on the idle callback, not fired yet.
        expect(onCommit).not.toHaveBeenCalled();
        expect(idleCallbacks).toHaveLength(1);
        idleCallbacks.shift()!();
        expect(onCommit).toHaveBeenCalledExactlyOnceWith('x', 'loaded');
      } finally {
        (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
        (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCIC;
      }
    });

    it("skips the idle defer when lazyCommitPriority is 'normal'", async () => {
      registerPeer<string>('ch', 'p1');
      const idleCallbacks: Array<() => void> = [];
      const originalRIC = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      const originalCIC = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
        idleCallbacks.push(cb);
        return idleCallbacks.length;
      };
      (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => {};
      try {
        const onCommit = vi.fn();
        const handle = announceTarget('ch', 'p1', 'x', {
          causesLayoutShift: () => false,
          preload: async () => 'loaded',
          onCommit,
          lazyCommitPriority: 'normal',
          isOriginator: false,
          announceTime: Date.now(),
        });
        await handle.settled;
        expect(onCommit).toHaveBeenCalledExactlyOnceWith('x', 'loaded');
        expect(idleCallbacks).toHaveLength(0);
      } finally {
        (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
        (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCIC;
      }
    });

    it('falls back to a synchronous commit when requestIdleCallback is unavailable', async () => {
      registerPeer<string>('ch', 'p1');
      const originalRIC = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      const originalCIC = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      try {
        const onCommit = vi.fn();
        const handle = announceTarget('ch', 'p1', 'x', {
          causesLayoutShift: () => false,
          preload: async () => 'loaded',
          onCommit,
          isOriginator: false,
          announceTime: Date.now(),
        });
        await handle.settled;
        expect(onCommit).toHaveBeenCalledExactlyOnceWith('x', 'loaded');
      } finally {
        if (originalRIC !== undefined) {
          (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
        }
        if (originalCIC !== undefined) {
          (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCIC;
        }
      }
    });

    it('cancels in-flight lazy-path work when peer unregisters', async () => {
      const unregister = registerPeer<string>('ch', 'p1');
      const onCommit = vi.fn();
      const handle = announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => false,
        preload: async (_t, signal) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 100);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          });
          return 'never';
        },
        onCommit,
        isOriginator: false,
        announceTime: Date.now(),
      });
      await Promise.resolve();
      unregister();
      await handle.settled;
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('honors minWaitMs anchored to announceTime before commit', async () => {
      registerPeer<string>('ch', 'p1');
      const onCommit = vi.fn();
      // Announce 100ms in the "past" so anchor logic shows up.
      const announceTime = Date.now() - 100;
      const handle = announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => false,
        onCommit,
        isOriginator: false,
        announceTime,
        minWaitMs: 200,
      });
      // Allow preload microtasks to drain; commit should still wait
      // because the wall-clock window is anchored to announceTime.
      await flushMicrotasks();
      expect(onCommit).not.toHaveBeenCalled();
      // Roughly 100ms remaining (200ms window - 100ms elapsed before
      // announce). Wait a touch more than that.
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      await handle.settled;
      expect(onCommit).toHaveBeenCalledWith('A', undefined);
    });
  });

  describe('the barrier path (high priority barrier)', () => {
    it('commits async barrier-path peers in announce order', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      registerPeer<string>('ch', 'p3');
      const commitOrder: string[] = [];
      // Each preload resolves on its own microtask; the engine awaits
      // results in announce order on the channel's barrier tail so
      // commits land in that same order even though the preloads
      // themselves run concurrently.
      const slowPreload = async (target: string) => {
        await nextTick();
        return target;
      };
      const make =
        (label: string) =>
        (..._args: unknown[]): void => {
          commitOrder.push(label);
        };
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: slowPreload,
        onCommit: make('p1'),
        isOriginator: true,
        announceTime: now,
      });
      const h2 = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => true,
        preload: slowPreload,
        onCommit: make('p2'),
        isOriginator: false,
        announceTime: now,
      });
      const h3 = announceTarget('ch', 'p3', 'X', {
        causesLayoutShift: () => true,
        preload: slowPreload,
        onCommit: make('p3'),
        isOriginator: false,
        announceTime: now,
      });
      await Promise.all([h1.settled, h2.settled, h3.settled]);
      expect(commitOrder).toEqual(['p1', 'p2', 'p3']);
    });

    it('commits all barrier-path waiters in the same microtask (batched barrier)', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const commitOrder: string[] = [];
      const preload = async (t: string) => t;
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload,
        onCommit: () => commitOrder.push('p1'),
        isOriginator: true,
        announceTime: now,
      });
      const h2 = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => true,
        preload,
        onCommit: () => commitOrder.push('p2'),
        isOriginator: false,
        announceTime: now,
      });
      await Promise.all([h1.settled, h2.settled]);
      // Both commits fire when the barrier resolves, in registration order.
      expect(commitOrder).toEqual(['p1', 'p2']);
    });

    it('passes preloaded values into the corresponding onCommit', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const onCommit1 = vi.fn();
      const onCommit2 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1-payload',
        onCommit: onCommit1,
        isOriginator: true,
        announceTime: now,
      });
      const h2 = announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p2-payload',
        onCommit: onCommit2,
        isOriginator: false,
        announceTime: now,
      });
      await Promise.all([h1.settled, h2.settled]);
      expect(onCommit1).toHaveBeenCalledWith('T', 'p1-payload');
      expect(onCommit2).toHaveBeenCalledWith('T', 'p2-payload');
    });

    it('respects minWaitMs even when all peers have preloaded', async () => {
      registerPeer<string>('ch', 'p1');
      const commitAt = { value: 0 };
      const t0 = Date.now();
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'ok',
        onCommit: () => {
          commitAt.value = Date.now();
        },
        minWaitMs: 50,
        isOriginator: true,
        announceTime: t0,
      });
      await handle.settled;
      // Commit must be at least minWaitMs after announceTime.
      expect(commitAt.value - t0).toBeGreaterThanOrEqual(45); // small tolerance for timer drift
    });

    it('fires onWaitingForPeers only for originator after gracePeriodMs', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const waitingP1 = vi.fn();
      const waitingP2 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'ok',
        onCommit: () => {},
        gracePeriodMs: 30,
        ultimateTimeoutMs: 200,
        onWaitingForPeers: waitingP1,
        isOriginator: true,
        announceTime: now,
      });
      // p2 never preloads (simulate stuck peer)
      const h2 = announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: () =>
          new Promise<string>(() => {
            // never resolves
          }),
        onCommit: () => {},
        onWaitingForPeers: waitingP2,
        isOriginator: false,
        announceTime: now,
      });
      // Wait long enough for grace to fire
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80);
      });
      expect(waitingP1).toHaveBeenCalledOnce();
      expect(waitingP2).not.toHaveBeenCalled();
      h2.cancel();
      await h1.settled;
    });

    it('force-resolves at ultimateTimeoutMs with a console warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const onCommit1 = vi.fn();
      const onCommit2 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'ok',
        onCommit: onCommit1,
        ultimateTimeoutMs: 50,
        isOriginator: true,
        announceTime: now,
      });
      announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: () => new Promise<string>(() => {}),
        onCommit: onCommit2,
        ultimateTimeoutMs: 50,
        isOriginator: false,
        announceTime: now,
      });
      await h1.settled;
      expect(onCommit1).toHaveBeenCalledOnce();
      expect(onCommit2).toHaveBeenCalledOnce(); // force-resolved with undefined preloaded
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/force-resolved/);
      warnSpy.mockRestore();
    });

    it('canceling the last waiter clears the pending barrier', async () => {
      registerPeer<string>('ch', 'p1');
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: () => new Promise<string>(() => {}),
        onCommit: () => {},
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: Date.now(),
      });
      expect(getCoordinatorStatsForTests().totalPendingBarriers).toBe(1);
      handle.cancel();
      await handle.settled;
      expect(getCoordinatorStatsForTests().totalPendingBarriers).toBe(0);
    });

    it('unregistering a peer drops its waiter from the barrier and re-checks resolution', async () => {
      registerPeer<string>('ch', 'p1');
      const unregister2 = registerPeer<string>('ch', 'p2');
      const onCommit1 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: now,
      });
      // p2 enqueues a never-resolving preload
      announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: () => new Promise<string>(() => {}),
        onCommit: () => {},
        ultimateTimeoutMs: 5_000,
        isOriginator: false,
        announceTime: now,
      });
      // After p1's preload finishes, the barrier is still waiting for p2.
      await flushMicrotasks(20);
      expect(onCommit1).not.toHaveBeenCalled();
      // Unregistering p2 should let the barrier resolve with just p1.
      unregister2();
      await h1.settled;
      expect(onCommit1).toHaveBeenCalledOnce();
    });

    it('does not wait for a registered peer that is already committed to the target', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      reportValue('ch', 'p2', 'T');

      const onCommit1 = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 50,
        isOriginator: true,
        announceTime: Date.now(),
      });

      // Preload yields to the main thread via setTimeout(0), so a
      // macrotask flush is required before the barrier can resolve.
      // Drain microtasks first so the preload's yield-setTimeout is
      // queued before `nextTick`'s own setTimeout.
      await flushMicrotasks();
      await nextTick();
      await flushMicrotasks(20);

      expect(onCommit1).toHaveBeenCalledOnce();
      expect(warnSpy).not.toHaveBeenCalled();
      await handle.settled;
      warnSpy.mockRestore();
    });

    it('does not let a stale skipped id let a barrier commit without a replacement peer', async () => {
      // Scenario: p2 is "already at target" so it lands in
      // `barrier.skipped` (not `waiters`). p2 then unmounts and is
      // replaced by p3. Before the fix, the leftover skipped entry
      // for p2 satisfied the quorum check for p3, and the barrier
      // could resolve without p3 ever joining.
      registerPeer<string>('ch', 'p1');
      const unregister2 = registerPeer<string>('ch', 'p2');
      reportValue('ch', 'p2', 'T');

      const onCommit1 = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        // Keep the barrier open long enough for the unmount/remount
        // dance below.
        preload: () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve('p1'), 30);
          }),
        onCommit: onCommit1,
        ultimateTimeoutMs: 200,
        isOriginator: true,
        announceTime: Date.now(),
      });

      unregister2();
      registerPeer<string>('ch', 'p3');

      await flushMicrotasks(20);
      // p3 has not joined and p2 is gone — the barrier must keep
      // waiting rather than committing on a stale skipped count.
      expect(onCommit1).not.toHaveBeenCalled();

      // Letting p3 announce completes the barrier as expected.
      announceTarget('ch', 'p3', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p3',
        onCommit: () => {},
        isOriginator: false,
        announceTime: Date.now(),
      });
      await handle.settled;
      expect(onCommit1).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it('re-checks barrier resolution when a registered-but-never-joined peer unmounts', async () => {
      // Scenario: p2 registered on the channel but never announced
      // (and never reported a matching value, so it's neither a
      // waiter nor in `skipped`). When p2 unmounts, `channel.peers`
      // shrinks, which can make the barrier satisfiable for the
      // remaining peers. The unregister path must re-check
      // resolution even though the departing peer wasn't a waiter,
      // otherwise the barrier sits open until the ultimate timeout.
      registerPeer<string>('ch', 'p1');
      const unregister2 = registerPeer<string>('ch', 'p2');

      const onCommit1 = vi.fn();
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: Date.now(),
      });

      // p1's preload settles, but the barrier is still waiting for p2.
      await flushMicrotasks(20);
      expect(onCommit1).not.toHaveBeenCalled();

      // p2 leaves without ever joining the barrier. The barrier
      // should resolve promptly, not wait for the ultimate timeout.
      unregister2();
      await handle.settled;
      expect(onCommit1).toHaveBeenCalledOnce();
    });
  });

  describe('mixed phases', () => {
    it('barrier-path commit fires before any gated lazy-path work begins', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const events: string[] = [];
      const now = Date.now();
      // p2 announces a lazy-path target first (no barrier exists yet).
      const lazy = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => false,
        preload: async () => {
          events.push('lazy-preload-start');
          await nextTick();
          events.push('lazy-preload-end');
          return 'p2';
        },
        onCommit: () => events.push('lazy-commit'),
        isOriginator: false,
        announceTime: now,
      });
      // p1 synchronously announces a barrier on the same target. The
      // lazy peer's start is microtask-deferred, so by the time it
      // checks for a same-target barrier, p1's barrier is open and
      // p2 gates on it.
      const barrier = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: () => events.push('barrier-commit'),
        isOriginator: true,
        announceTime: now,
      });
      await barrier.settled;
      // Lazy peer's preload hasn't even started yet — it's waiting
      // for the post-barrier macrotask release.
      expect(events).toEqual(['barrier-commit']);
      await lazy.settled;
      // After release, lazy runs its full pipeline.
      expect(events).toEqual([
        'barrier-commit',
        'lazy-preload-start',
        'lazy-preload-end',
        'lazy-commit',
      ]);
    });

    it('lazy peer with `preloadAll: true` runs preload concurrently with the barrier but still commits after it', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const events: string[] = [];
      const now = Date.now();
      const lazy = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => false,
        preloadAll: true,
        preload: async () => {
          events.push('lazy-preload-start');
          await nextTick();
          events.push('lazy-preload-end');
          return 'p2';
        },
        onCommit: () => events.push('lazy-commit'),
        isOriginator: false,
        announceTime: now,
      });
      const barrier = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => {
          events.push('barrier-preload-start');
          await nextTick();
          events.push('barrier-preload-end');
          return 'p1';
        },
        onCommit: () => events.push('barrier-commit'),
        isOriginator: true,
        announceTime: now,
      });
      await Promise.all([barrier.settled, lazy.settled]);
      // Both preloads ran concurrently, but the barrier commit fires
      // before the lazy commit, and the lazy commit lands after a
      // setTimeout(0) hop (the "render after barrier commits" window).
      expect(events.indexOf('barrier-commit')).toBeLessThan(events.indexOf('lazy-commit'));
      expect(events).toContain('lazy-preload-start');
      expect(events).toContain('lazy-preload-end');
      // lazy-preload-start should come before barrier-commit because
      // it was kicked off synchronously with the barrier (concurrent),
      // not deferred until after.
      expect(events.indexOf('lazy-preload-start')).toBeLessThan(events.indexOf('barrier-commit'));
    });

    it('lazy peer with no same-target barrier runs immediately (no deferral)', async () => {
      registerPeer<string>('ch', 'p1');
      const events: string[] = [];
      const lazy = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => false,
        preload: async () => {
          events.push('lazy-preload');
          return 'p1';
        },
        onCommit: () => events.push('lazy-commit'),
        isOriginator: false,
        announceTime: Date.now(),
      });
      await lazy.settled;
      expect(events).toEqual(['lazy-preload', 'lazy-commit']);
    });

    it('lazy peer announced before barrier in the same sync flush still gates on the barrier (microtask gate)', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const events: string[] = [];
      const now = Date.now();
      // Note: lazy announces FIRST in source order, but the gate
      // check happens one microtask later — by then p1's barrier is
      // already open.
      const lazy = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => false,
        preload: async () => 'p2',
        onCommit: () => events.push('lazy-commit'),
        isOriginator: false,
        announceTime: now,
      });
      const barrier = announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: () => events.push('barrier-commit'),
        isOriginator: true,
        announceTime: now,
      });
      await Promise.all([barrier.settled, lazy.settled]);
      expect(events).toEqual(['barrier-commit', 'lazy-commit']);
    });

    it('does not skip a peer whose pending lazy work is for a *different* target', async () => {
      // Regression: an open lazy task for target X used to mark the
      // peer as `skipped` on any newly-opened barrier, including
      // barriers for an unrelated target Y. A zero-wait
      // sync-preload barrier could then resolve early — committing
      // only the originator — before the lazy peer was notified to
      // join the new target. The skip is only valid for same-target
      // lazy work; for different-target lazy work the peer must
      // remain an expected waiter until it actually joins.
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const events: string[] = [];
      const now = Date.now();
      // p2 is mid-flight on a lazy commit for X (slow preload keeps
      // it in `lazyInFlight` for the duration of the test).
      const lazy = announceTarget('ch', 'p2', 'X', {
        causesLayoutShift: () => false,
        preload: () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve('p2:X'), 100);
          }),
        onCommit: (target, preloaded) => events.push(`p2-lazy:${target}:${preloaded}`),
        isOriginator: false,
        announceTime: now,
      });
      // p1 opens a zero-wait, sync-preload barrier on a DIFFERENT
      // target Y. Pre-fix, p2 was wrongly pre-skipped here and the
      // barrier resolved immediately with only p1.
      const barrierP1 = announceTarget('ch', 'p1', 'Y', {
        causesLayoutShift: () => true,
        preload: () => 'p1:Y',
        onCommit: (target, preloaded) => events.push(`p1-barrier:${target}:${preloaded}`),
        isOriginator: true,
        announceTime: now,
        minWaitMs: 0,
      });
      // Yield once so any (incorrect) sync resolution would have
      // fired. Post-fix the barrier stays open waiting for p2.
      await nextTick();
      expect(events).toEqual([]);
      // p2 now joins the barrier for Y (simulating what
      // `onSiblingAnnounce` would do in the real wrapper).
      const barrierP2 = announceTarget('ch', 'p2', 'Y', {
        causesLayoutShift: () => true,
        preload: () => 'p2:Y',
        onCommit: (target, preloaded) => events.push(`p2-barrier:${target}:${preloaded}`),
        isOriginator: false,
        announceTime: now,
        minWaitMs: 0,
      });
      await Promise.all([barrierP1.settled, barrierP2.settled, lazy.settled]);
      // Both barrier commits fire together for Y, and p2's unrelated
      // lazy commit for X lands afterwards on its own clock.
      const p1Idx = events.indexOf('p1-barrier:Y:p1:Y');
      const p2Idx = events.indexOf('p2-barrier:Y:p2:Y');
      const lazyIdx = events.indexOf('p2-lazy:X:p2:X');
      expect(p1Idx).toBeGreaterThanOrEqual(0);
      expect(p2Idx).toBeGreaterThanOrEqual(0);
      expect(lazyIdx).toBeGreaterThanOrEqual(0);
      expect(p1Idx).toBeLessThan(lazyIdx);
      expect(p2Idx).toBeLessThan(lazyIdx);
    });

    it('per-peer routing: same target, different peers, different priorities', async () => {
      registerPeer<string>('ch', 'p-high');
      registerPeer<string>('ch', 'p-low');
      const events: string[] = [];
      const now = Date.now();
      const causesLayoutShiftHigh = (): boolean => true;
      const causesLayoutShiftLow = (): boolean => false;
      const h1 = announceTarget('ch', 'p-high', 'T', {
        causesLayoutShift: causesLayoutShiftHigh,
        preload: async () => 'pre-high',
        onCommit: (_t, p) => events.push(`high:${p}`),
        isOriginator: true,
        announceTime: now,
      });
      const h2 = announceTarget('ch', 'p-low', 'T', {
        causesLayoutShift: causesLayoutShiftLow,
        preload: async () => 'pre-low',
        onCommit: (_t, p) => events.push(`low:${p}`),
        isOriginator: false,
        announceTime: now,
      });
      await Promise.all([h1.settled, h2.settled]);
      expect(events.slice().sort()).toEqual(['high:pre-high', 'low:pre-low'].sort());
    });
  });

  describe('sibling announce notification', () => {
    it('invokes onSiblingAnnounce on other peers when a peer announces a barrier target', () => {
      const seen: string[] = [];
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2', (target) => {
        seen.push(`p2:${target}`);
      });
      registerPeer<string>('ch', 'p3', (target) => {
        seen.push(`p3:${target}`);
      });
      announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => 'pre',
        onCommit: () => {},
        isOriginator: true,
        announceTime: Date.now(),
      });
      // Snapshot is taken before fanning out; both siblings are notified
      // synchronously, the announcer is not.
      expect(seen.sort()).toEqual(['p2:X', 'p3:X']);
    });

    it('invokes onSiblingAnnounce on other peers when a peer announces a lazy target', () => {
      const seen: string[] = [];
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2', (target) => {
        seen.push(`p2:${target}`);
      });
      announceTarget('ch', 'p1', 'L', {
        causesLayoutShift: () => false,
        preload: async () => 'pre',
        onCommit: () => {},
        isOriginator: false,
        announceTime: Date.now(),
      });
      expect(seen).toEqual(['p2:L']);
    });

    it('skips siblings already at the announced value', () => {
      const seen: string[] = [];
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2', (target) => {
        seen.push(`p2:${target}`);
      });
      // p2 is already at 'X' — reportValue updates currentValue.
      reportValue('ch', 'p2', 'X');
      announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => 'pre',
        onCommit: () => {},
        isOriginator: true,
        announceTime: Date.now(),
      });
      expect(seen).toEqual([]);
    });

    it('logs and continues if an onSiblingAnnounce callback throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seen: string[] = [];
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2', () => {
        throw new Error('boom');
      });
      registerPeer<string>('ch', 'p3', (target) => {
        seen.push(`p3:${target}`);
      });
      announceTarget('ch', 'p1', 'X', {
        causesLayoutShift: () => true,
        preload: async () => 'pre',
        onCommit: () => {},
        isOriginator: true,
        announceTime: Date.now(),
      });
      expect(seen).toEqual(['p3:X']);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('late peer registration during open barrier', () => {
    it('replays the open barrier announcement to a newcomer so it can join the quorum', async () => {
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const onCommit1 = vi.fn();
      const onCommit2 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: now,
      });
      announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p2',
        onCommit: onCommit2,
        ultimateTimeoutMs: 5_000,
        isOriginator: false,
        announceTime: now,
      });

      // A third peer mounts after the barrier has opened. Without the
      // replay it would never learn about target 'T' and the barrier
      // would sit open until ultimateTimeoutMs.
      const seenP3: string[] = [];
      const onCommit3 = vi.fn();
      registerPeer<string>('ch', 'p3', (target) => {
        seenP3.push(target);
        announceTarget('ch', 'p3', target, {
          causesLayoutShift: () => true,
          preload: async () => 'p3',
          onCommit: onCommit3,
          ultimateTimeoutMs: 5_000,
          isOriginator: false,
          announceTime: Date.now(),
        });
      });

      // Replay is microtask-deferred, so flush microtasks before
      // asserting it ran. The barrier itself still needs its preload
      // chain to drain (Promise.all of all waiters).
      await flushMicrotasks();
      expect(seenP3).toEqual(['T']);

      await h1.settled;
      expect(onCommit1).toHaveBeenCalledOnce();
      expect(onCommit2).toHaveBeenCalledOnce();
      expect(onCommit3).toHaveBeenCalledOnce();
    });

    it('does not replay when there are no open barriers', async () => {
      const seen: string[] = [];
      registerPeer<string>('ch', 'p1', (target) => {
        seen.push(target);
      });
      await flushMicrotasks();
      expect(seen).toEqual([]);
    });

    it('records the newcomer as skipped when its reported value already matches the barrier target', async () => {
      registerPeer<string>('ch', 'p1');
      const onCommit1 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: now,
      });

      // p2 mounts after the barrier opened. `reportValue` runs from
      // its insertion-effect with the already-persisted target value,
      // so the replay must NOT re-fire the receiver flow.
      const seenP2: string[] = [];
      const onCommit2 = vi.fn();
      registerPeer<string>('ch', 'p2', (target) => {
        seenP2.push(target);
        announceTarget('ch', 'p2', target, {
          causesLayoutShift: () => true,
          preload: async () => 'p2',
          onCommit: onCommit2,
          isOriginator: false,
          announceTime: Date.now(),
        });
      });
      reportValue('ch', 'p2', 'T');

      await h1.settled;
      // Replay treated p2 as already-at-target: no receiver
      // announcement, no extra preload, originator still commits.
      expect(seenP2).toEqual([]);
      expect(onCommit2).not.toHaveBeenCalled();
      expect(onCommit1).toHaveBeenCalledOnce();
    });

    it('treats a newcomer that immediately re-announces as a waiter (not a duplicate skipped)', async () => {
      // Guards against the replay double-counting a peer that ends up
      // joining as a waiter on its own (e.g. its insertion-effect
      // runs `runCoordination` against a stale value, which would
      // otherwise leave a stale skipped entry).
      registerPeer<string>('ch', 'p1');
      const onCommit1 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: now,
      });

      const onCommit2 = vi.fn();
      registerPeer<string>('ch', 'p2', (target) => {
        announceTarget('ch', 'p2', target, {
          causesLayoutShift: () => true,
          preload: async () => 'p2',
          onCommit: onCommit2,
          isOriginator: false,
          announceTime: Date.now(),
        });
      });

      await h1.settled;
      expect(onCommit1).toHaveBeenCalledExactlyOnceWith('T', 'p1');
      expect(onCommit2).toHaveBeenCalledExactlyOnceWith('T', 'p2');
    });

    it('skips replay when an unrelated peer unregisters before the microtask runs', async () => {
      registerPeer<string>('ch', 'p1');
      const onCommit1 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: onCommit1,
        ultimateTimeoutMs: 5_000,
        isOriginator: true,
        announceTime: now,
      });

      const seen: string[] = [];
      const unregister2 = registerPeer<string>('ch', 'p2', (target) => {
        seen.push(target);
      });
      // Unregister before the microtask-deferred replay runs — the
      // replay must detect that p2 is no longer the current peer and
      // skip the callback.
      unregister2();

      await h1.settled;
      expect(seen).toEqual([]);
      expect(onCommit1).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('rejected preload still allows the barrier to resolve (onCommit gets undefined)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      registerPeer<string>('ch', 'p1');
      const onCommit = vi.fn();
      const handle = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => {
          throw new Error('boom');
        },
        onCommit,
        isOriginator: true,
        announceTime: Date.now(),
      });
      await handle.settled;
      expect(onCommit).toHaveBeenCalledWith('T', undefined);
      errSpy.mockRestore();
    });

    it('throwing onCommit does not prevent sibling waiters from committing', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      registerPeer<string>('ch', 'p1');
      registerPeer<string>('ch', 'p2');
      const onCommit2 = vi.fn();
      const now = Date.now();
      const h1 = announceTarget('ch', 'p1', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p1',
        onCommit: () => {
          throw new Error('first commit threw');
        },
        isOriginator: true,
        announceTime: now,
      });
      const h2 = announceTarget('ch', 'p2', 'T', {
        causesLayoutShift: () => true,
        preload: async () => 'p2',
        onCommit: onCommit2,
        isOriginator: false,
        announceTime: now,
      });
      await Promise.all([h1.settled, h2.settled]);
      expect(onCommit2).toHaveBeenCalledOnce();
      errSpy.mockRestore();
    });

    it('throws when announcing on an unregistered peer', () => {
      expect(() =>
        announceTarget('ch', 'ghost', 'T', {
          causesLayoutShift: () => true,
          onCommit: () => {},
          isOriginator: true,
          announceTime: Date.now(),
        }),
      ).to.throw(/not registered/);
    });
  });

  describe('reportValue', () => {
    it('is a no-op for unknown channels and peers (does not throw)', () => {
      expect(() => reportValue('missing-channel', 'p', 'v')).not.toThrow();
      registerPeer('ch', 'p1');
      expect(() => reportValue('ch', 'p2', 'v')).not.toThrow();
    });
  });

  describe('hasEverAnnounced', () => {
    it('returns false for an unknown channel', () => {
      expect(hasEverAnnounced('nope')).toBe(false);
    });

    it('returns false for a channel that has peers but no announces', () => {
      registerPeer('ch', 'p1');
      expect(hasEverAnnounced('ch')).toBe(false);
    });

    it('returns true once any peer announces (barrier path)', () => {
      registerPeer('ch', 'p1');
      announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => true,
        onCommit: () => {},
        isOriginator: true,
        announceTime: Date.now(),
      });
      expect(hasEverAnnounced('ch')).toBe(true);
    });

    it('returns true once any peer announces (lazy path)', () => {
      registerPeer('ch', 'p1');
      announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => false,
        onCommit: () => {},
        isOriginator: false,
        announceTime: Date.now(),
      });
      expect(hasEverAnnounced('ch')).toBe(true);
    });
  });

  describe('getBarrierAnnounceTime', () => {
    it('returns null when no channel exists', () => {
      expect(getBarrierAnnounceTime('nope', 'A')).toBe(null);
    });

    it('returns null when no barrier is open for the target', () => {
      registerPeer('ch', 'p1');
      announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => true,
        onCommit: () => {},
        isOriginator: true,
        announceTime: Date.now(),
      });
      expect(getBarrierAnnounceTime('ch', 'OTHER')).toBe(null);
    });

    it('returns the announceTime recorded when the barrier was opened', () => {
      registerPeer('ch', 'p1');
      const announceTime = 12345;
      announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => true,
        // Pending preload keeps the barrier open long enough for the
        // assertion to observe it.
        preload: () => new Promise<void>(() => {}),
        onCommit: () => {},
        isOriginator: true,
        announceTime,
        minWaitMs: 1000,
        gracePeriodMs: 1000,
        ultimateTimeoutMs: 10000,
      });
      expect(getBarrierAnnounceTime('ch', 'A')).toBe(announceTime);
    });

    it('first announceTime wins when peers join with different anchors', () => {
      registerPeer('ch', 'p1');
      registerPeer('ch', 'p2');
      const first = 1000;
      const later = 5000;
      announceTarget('ch', 'p1', 'A', {
        causesLayoutShift: () => true,
        preload: () => new Promise<void>(() => {}),
        onCommit: () => {},
        isOriginator: true,
        announceTime: first,
        minWaitMs: 10000,
        gracePeriodMs: 10000,
        ultimateTimeoutMs: 60000,
      });
      announceTarget('ch', 'p2', 'A', {
        causesLayoutShift: () => true,
        preload: () => new Promise<void>(() => {}),
        onCommit: () => {},
        isOriginator: false,
        announceTime: later,
        minWaitMs: 10000,
        gracePeriodMs: 10000,
        ultimateTimeoutMs: 60000,
      });
      expect(getBarrierAnnounceTime('ch', 'A')).toBe(first);
    });
  });

  describe('yieldToMain (scheduler.yield branch)', () => {
    it('uses scheduler.yield() when available instead of setTimeout', async () => {
      // Modern Chromium exposes `scheduler.yield()`, which the
      // coordinator prefers over the `setTimeout(_, 0)` fallback.
      // Install a fake on `globalThis` and assert that the preload
      // is gated on its promise rather than on a macrotask.
      const realScheduler = (globalThis as { scheduler?: unknown }).scheduler;
      let resolveYield: (() => void) | undefined;
      const yieldSpy = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveYield = resolve;
          }),
      );
      (globalThis as { scheduler?: { yield: () => Promise<void> } }).scheduler = {
        yield: yieldSpy,
      };
      try {
        registerPeer<string>('ch', 'p1');
        const preload = vi.fn(async () => {});
        const onCommit = vi.fn();
        announceTarget('ch', 'p1', 'target', {
          causesLayoutShift: () => true,
          preload,
          onCommit,
          isOriginator: true,
          announceTime: Date.now(),
        });

        // The barrier ran `scheduler.yield()` once and is parked on
        // its pending promise — preload hasn't been invoked yet
        // even after draining microtasks and a macrotask.
        await flushMicrotasks();
        await nextTick();
        expect(yieldSpy).toHaveBeenCalledTimes(1);
        expect(preload).not.toHaveBeenCalled();

        // Resolving the yield promise releases the preload.
        resolveYield!();
        await flushMicrotasks();
        expect(preload).toHaveBeenCalledTimes(1);
        await flushMicrotasks();
        expect(onCommit).toHaveBeenCalledTimes(1);
      } finally {
        if (realScheduler === undefined) {
          delete (globalThis as { scheduler?: unknown }).scheduler;
        } else {
          (globalThis as { scheduler?: unknown }).scheduler = realScheduler;
        }
      }
    });
  });
});

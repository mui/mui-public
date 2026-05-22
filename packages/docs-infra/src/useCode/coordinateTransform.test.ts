// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  scheduleIdle,
  scheduleTask,
  getTransformCoordinator,
  resetTransformCoordinatorsForTests,
} from './coordinateTransform';

describe('scheduleIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses requestIdleCallback when available', () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);

    const work = vi.fn();
    scheduleIdle(work);

    expect(ric).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('passes the timeout option to requestIdleCallback', () => {
    const ric = vi.fn(() => 1);
    vi.stubGlobal('requestIdleCallback', ric);

    scheduleIdle(() => {}, 123);

    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 123 });
  });

  it('cancels pending idle callbacks when the returned cancel runs', () => {
    const ric = vi.fn(() => 42);
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);

    const cancel = scheduleIdle(() => {});
    cancel();

    expect(cic).toHaveBeenCalledWith(42);
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);

    const work = vi.fn();
    scheduleIdle(work);

    expect(work).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('cancels the setTimeout fallback', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);

    const work = vi.fn();
    const cancel = scheduleIdle(work);
    cancel();
    vi.runAllTimers();

    expect(work).not.toHaveBeenCalled();
  });
});

describe('scheduleTask', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('prefers `scheduler.postTask` when available', () => {
    const postTask = vi.fn((cb: () => void) => {
      cb();
      return Promise.resolve();
    });
    vi.stubGlobal('scheduler', { postTask });

    const work = vi.fn();
    scheduleTask(work);

    expect(postTask).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('passes `user-blocking` priority and an `AbortSignal` to `postTask`', () => {
    const postTask = vi.fn(() => Promise.resolve());
    vi.stubGlobal('scheduler', { postTask });

    scheduleTask(() => {});

    expect(postTask).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        priority: 'user-blocking',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('aborts the `postTask` signal when cancelled', () => {
    let capturedSignal: AbortSignal | undefined;
    const postTask = vi.fn((_cb: () => void, opts?: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      return Promise.resolve();
    });
    vi.stubGlobal('scheduler', { postTask });

    const cancel = scheduleTask(() => {});
    expect(capturedSignal?.aborted).toBe(false);
    cancel();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('falls back to `setTimeout(fn, 0)` when `scheduler.postTask` is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('scheduler', undefined);
    const work = vi.fn();
    scheduleTask(work);

    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not run the callback when cancelled before the `setTimeout` fires', () => {
    vi.useFakeTimers();
    vi.stubGlobal('scheduler', undefined);
    const work = vi.fn();
    const cancel = scheduleTask(work);
    cancel();

    vi.advanceTimersByTime(0);
    expect(work).not.toHaveBeenCalled();
  });
});

describe('TransformCoordinator', () => {
  afterEach(() => {
    resetTransformCoordinatorsForTests();
    vi.useRealTimers();
  });

  it('returns the same instance for the same storage key', () => {
    const a = getTransformCoordinator('test-key-a');
    const b = getTransformCoordinator('test-key-a');
    expect(a).toBe(b);
  });

  it('commits a single-demo barrier at minWaitMs when there are no peers', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-single');
    const unregister = coord.register('demo-1');
    const onCommit = vi.fn();

    coord.openBarrier('demo-1', {
      announceTime: Date.now(),
      minWaitMs: 250,
      gracePeriodMs: 300,
      isOriginator: true,
      value: 'esm',
      onCommit,
    });

    // Ack immediately (precompute "fast"), but commit must still wait
    // until the animation window has elapsed.
    coord.acknowledge('demo-1', 'esm');

    vi.advanceTimersByTime(249);
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('forces commit at the ultimate-timeout safety net when a peer never acks', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = getTransformCoordinator('test-slow');

    coord.register('demo-1');
    coord.register('demo-slow');

    const onCommit = vi.fn();
    const onWaitingForPeers = vi.fn();
    coord.openBarrier('demo-1', {
      announceTime: Date.now(),
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 1_000,
      isOriginator: true,
      value: 'esm',
      onCommit,
      onWaitingForPeers,
    });
    coord.acknowledge('demo-1', 'esm');

    // `demo-slow` is a local sibling included in `expectedPeers`. It
    // never opens a barrier and never acks.
    //
    // - At `minWait` (100ms): nothing — animation window done but
    //   peer still pending.
    // - At `minWait + gracePeriod` (300ms): `onWaitingForPeers`
    //   fires so the originator can surface a loading indicator,
    //   but the barrier keeps waiting (no force-resolve).
    // - At `ultimateTimeoutMs` (1000ms): safety net triggers,
    //   barrier force-resolves with a `console.warn`.
    vi.advanceTimersByTime(100);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onWaitingForPeers).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onWaitingForPeers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(700);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('force-resolved');

    warn.mockRestore();
  });

  it('does not call `onWaitingForPeers` when every peer acks before the grace period', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-no-wait');
    coord.register('demo-a');
    coord.register('demo-b');

    const onCommit = vi.fn();
    const onWaitingForPeers = vi.fn();
    const announceTime = Date.now();
    coord.openBarrier('demo-a', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: true,
      value: 'esm',
      onCommit,
      onWaitingForPeers,
    });
    coord.openBarrier('demo-b', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: false,
      value: 'esm',
      onCommit: vi.fn(),
    });

    coord.acknowledge('demo-a', 'esm');
    coord.acknowledge('demo-b', 'esm');

    vi.advanceTimersByTime(100);
    expect(onCommit).toHaveBeenCalledTimes(1);

    // Advance well past the grace boundary — `onWaitingForPeers`
    // must never fire because the barrier resolved at `minWait`.
    vi.advanceTimersByTime(500);
    expect(onWaitingForPeers).not.toHaveBeenCalled();
  });

  it('commits all waiters together when a slow peer acks between grace and the safety net', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-late-ack');
    coord.register('originator');
    coord.register('slow-peer');

    const originatorCommit = vi.fn();
    const slowCommit = vi.fn();
    const onWaitingForPeers = vi.fn();
    const announceTime = Date.now();

    coord.openBarrier('originator', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit: originatorCommit,
      onWaitingForPeers,
    });
    coord.acknowledge('originator', 'esm');

    // Past `minWait + gracePeriod` (300ms) but well before the
    // safety net — `onWaitingForPeers` should have fired.
    vi.advanceTimersByTime(400);
    expect(originatorCommit).not.toHaveBeenCalled();
    expect(onWaitingForPeers).toHaveBeenCalledTimes(1);

    // Slow peer finally catches up and acks. Barrier resolves
    // immediately for both — lockstep preserved despite the wait.
    coord.openBarrier('slow-peer', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: false,
      value: 'esm',
      onCommit: slowCommit,
    });
    coord.acknowledge('slow-peer', 'esm');

    expect(originatorCommit).toHaveBeenCalledTimes(1);
    expect(slowCommit).toHaveBeenCalledTimes(1);
  });

  it('fires `onWaitingForPeers` on an originator that joins after the grace boundary has passed', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-late-originator');
    coord.register('first');
    coord.register('second');
    coord.register('never-acks');

    const firstWaiting = vi.fn();
    const secondWaiting = vi.fn();
    const announceTime = Date.now();

    coord.openBarrier('first', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit: vi.fn(),
      onWaitingForPeers: firstWaiting,
    });
    coord.acknowledge('first', 'esm');
    vi.advanceTimersByTime(400);
    expect(firstWaiting).toHaveBeenCalledTimes(1);

    // A second originator-style waiter joins the same barrier after
    // the grace boundary already fired. It should still see
    // `onWaitingForPeers` immediately so its indicator UI lights up.
    coord.openBarrier('second', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit: vi.fn(),
      onWaitingForPeers: secondWaiting,
    });
    expect(secondWaiting).toHaveBeenCalledTimes(1);
  });

  it('commits both originator and joiner barriers when both ack', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-multi');
    coord.register('demo-a');
    coord.register('demo-b');

    const commitA = vi.fn();
    const commitB = vi.fn();
    const announceTime = Date.now();

    coord.openBarrier('demo-a', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: true,
      value: 'esm',
      onCommit: commitA,
    });
    coord.openBarrier('demo-b', {
      announceTime,
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: false,
      value: 'esm',
      onCommit: commitB,
    });

    coord.acknowledge('demo-a', 'esm');
    coord.acknowledge('demo-b', 'esm');

    vi.advanceTimersByTime(100);
    expect(commitA).toHaveBeenCalledTimes(1);
    expect(commitB).toHaveBeenCalledTimes(1);
  });

  it('cancels a barrier when its waiter is removed', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-cancel');
    coord.register('demo-1');
    const onCommit = vi.fn();

    const cancel = coord.openBarrier('demo-1', {
      announceTime: Date.now(),
      minWaitMs: 100,
      gracePeriodMs: 200,
      isOriginator: true,
      value: 'esm',
      onCommit,
    });

    cancel();
    vi.advanceTimersByTime(500);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('holds the originator barrier until a late-joining local sibling acks', () => {
    // Regression test for the originator/peer drift bug. In a real
    // page, sibling demos register synchronously (their effects run in
    // the same React commit), but they only `openBarrier` after the
    // `usePreference` broadcast propagates — typically 100–300ms after
    // the originator. If the originator's `expectedPeers` set were
    // seeded only from `knownPeers` (remote `BroadcastChannel` peers),
    // it would resolve alone at `minWait` and the late sibling would
    // open a second, already-past-minWait barrier and self-resolve
    // immediately — visibly drifted from the originator.
    //
    // The fix seeds `expectedPeers` with both `knownPeers` *and*
    // `localDemos`, so the originator's barrier holds until the
    // sibling joins and acks, at which point both commit in the same
    // tick at `minWait` expiry.
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-late-sibling');

    // Both demos are registered in the same React commit.
    coord.register('originator');
    coord.register('late-sibling');

    const originatorCommit = vi.fn();
    const siblingCommit = vi.fn();
    const announceTime = Date.now();

    // Originator opens immediately and acks (precompute was fast).
    coord.openBarrier('originator', {
      announceTime,
      minWaitMs: 250,
      gracePeriodMs: 300,
      isOriginator: true,
      value: 'esm',
      onCommit: originatorCommit,
    });
    coord.acknowledge('originator', 'esm');

    // Time passes — `minWait` expires but the sibling has not yet
    // opened its barrier. Without the local-sibling fix the
    // originator would commit here alone.
    vi.advanceTimersByTime(250);
    expect(originatorCommit).not.toHaveBeenCalled();

    // Sibling finally catches up (e.g. `usePreference` broadcast
    // arrived) and opens its barrier. It joins the existing barrier
    // (same key + announceTime).
    coord.openBarrier('late-sibling', {
      announceTime,
      minWaitMs: 250,
      gracePeriodMs: 300,
      isOriginator: false,
      value: 'esm',
      onCommit: siblingCommit,
    });
    coord.acknowledge('late-sibling', 'esm');

    // Both barriers resolve together as soon as the sibling acks
    // (`minWait` has already elapsed and every expected peer has
    // checked in).
    expect(originatorCommit).toHaveBeenCalledTimes(1);
    expect(siblingCommit).toHaveBeenCalledTimes(1);
  });

  it('handles separate barriers for different target values', () => {
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-cycle');
    coord.register('demo-1');

    const commitA = vi.fn();
    const commitB = vi.fn();
    const announceTime = Date.now();

    coord.openBarrier('demo-1', {
      announceTime,
      minWaitMs: 100,
      isOriginator: true,
      value: 'esm',
      onCommit: commitA,
    });
    // Switch target before the first barrier resolves.
    coord.openBarrier('demo-1', {
      announceTime,
      minWaitMs: 100,
      isOriginator: true,
      value: 'cjs',
      onCommit: commitB,
    });

    coord.acknowledge('demo-1', 'esm');
    coord.acknowledge('demo-1', 'cjs');

    vi.advanceTimersByTime(100);
    expect(commitA).toHaveBeenCalledTimes(1);
    expect(commitB).toHaveBeenCalledTimes(1);
  });

  it('excludes local peers already at the target value from `expectedPeers`', () => {
    // Regression: if a sibling is already at the target value, it
    // won't open a barrier or ack (no swap is scheduled). The
    // originator must not wait on it — otherwise the barrier hangs
    // until the ultimate safety net fires.
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-already-at-target');
    coord.register('originator');
    coord.register('already-there');

    // Sibling reports its current intent: already 'esm'.
    coord.setLocalValue('already-there', 'esm');

    const originatorCommit = vi.fn();
    coord.openBarrier('originator', {
      announceTime: Date.now(),
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit: originatorCommit,
    });
    coord.acknowledge('originator', 'esm');

    // Resolves at `minWait` because `already-there` was excluded.
    vi.advanceTimersByTime(100);
    expect(originatorCommit).toHaveBeenCalledTimes(1);
  });

  it('implicitly acks an open barrier when a peer reports a matching value', () => {
    // Covers the timing case where the originator opens its barrier
    // before the late sibling reports its (matching) value. Once the
    // sibling reports, the barrier should resolve immediately at
    // `minWait` — not hang to the safety net.
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-implicit-ack');
    coord.register('originator');
    coord.register('late-reporter');

    const originatorCommit = vi.fn();
    coord.openBarrier('originator', {
      announceTime: Date.now(),
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit: originatorCommit,
    });
    coord.acknowledge('originator', 'esm');

    // Sibling hasn't reported yet — included in expectedPeers.
    vi.advanceTimersByTime(100);
    expect(originatorCommit).not.toHaveBeenCalled();

    // Sibling now reports that it was already at 'esm'. The
    // coordinator implicitly acks on its behalf.
    coord.setLocalValue('late-reporter', 'esm');
    expect(originatorCommit).toHaveBeenCalledTimes(1);
  });

  it('self-acks the opener when its reported value already matches the target', () => {
    // Regression: the originator is added as a waiter at `openBarrier`
    // time, but only acks itself via the deferred precompute
    // `scheduleTask`. If `setLocalValue` has already reported the
    // matching value (which it always has in `useTransformManagement`
    // because the value-reporting effect is declared before the swap
    // effect), the opener should be self-acked immediately so the
    // barrier doesn't hang on its waiter slot if the deferred ack
    // never fires.
    vi.useFakeTimers();
    const coord = getTransformCoordinator('test-self-ack');
    coord.register('originator');

    // Originator reports its intent (mirrors `useTransformManagement`'s
    // value-reporting effect running before the swap effect).
    coord.setLocalValue('originator', 'esm');

    const onCommit = vi.fn();
    coord.openBarrier('originator', {
      announceTime: Date.now(),
      minWaitMs: 100,
      gracePeriodMs: 200,
      ultimateTimeoutMs: 5_000,
      isOriginator: true,
      value: 'esm',
      onCommit,
    });
    // Deliberately do NOT call `coord.acknowledge` — simulating the
    // deferred precompute task never firing (cancelled, throttled,
    // etc.). The barrier should still resolve at `minWait` because
    // the self-ack covered the originator's waiter slot.
    vi.advanceTimersByTime(100);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps the most recent announce timestamp for a repeated value', () => {
    // Regression: late peers within the freshness window must align
    // to the *current* interaction, not the earlier one. Storing the
    // older timestamp would make `getEffectiveAnnounceTime` return a
    // deadline already in the past, causing peers to skip the
    // coordinated delay and shift the page out of sync with the
    // originator.
    const coord = getTransformCoordinator('test-repeat-announce');
    coord.register('originator');

    const firstAnnounce = Date.now();
    coord.openBarrier('originator', {
      announceTime: firstAnnounce,
      minWaitMs: 0,
      isOriginator: true,
      value: 'esm',
      onCommit: () => {},
    });

    const secondAnnounce = firstAnnounce + 1_000;
    coord.openBarrier('originator', {
      announceTime: secondAnnounce,
      minWaitMs: 0,
      isOriginator: true,
      value: 'esm',
      onCommit: () => {},
    });

    // A late peer asking for the effective anchor with a local
    // fallback past both announces should receive the *later* stored
    // timestamp — never the earlier one.
    const peerFallback = secondAnnounce + 50;
    expect(coord.getEffectiveAnnounceTime('esm', peerFallback)).toBe(secondAnnounce);
  });
});

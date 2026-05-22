/**
 * Per-storage-key coordinator that batches transform application across
 * demos sharing the same broadcast channel. Each demo schedules its
 * `createTransformedFiles` work (or any precompute) in
 * `requestIdleCallback`, then acks via `BroadcastChannel`. Every demo
 * opens a local barrier keyed by the target value, and the barrier
 * resolves either when every known peer has acked for that value or
 * after a hard deadline (default 300ms) — whichever comes first. This
 * keeps the DOM swap in sync across peers even when one of them is
 * slower to precompute.
 *
 * Falls back to a no-coordination, deadline-only mode when
 * `BroadcastChannel` is unavailable (SSR, very old Safari). In that
 * mode the local demo still benefits from rIC precompute; cross-tab
 * and cross-instance lockstep just degrades to wall-clock alignment via
 * the existing `usePreference` storage broadcast.
 *
 * Commits are split into two phases by `useTransformManagement`: phase
 * 1 for transforms that change document height (those whose delta
 * inserts a `.collapse` placeholder — flagged at build time via
 * `hasCollapse` on the manifest entry), which must hit the deadline so
 * the page does not jitter; phase 2 for non-layout transforms applied
 * after phase 1 settles. The coordinator itself is phase-agnostic —
 * callers open separate barriers per phase.
 */

const CHANNEL_PREFIX = 'docs-infra-transform:';
const PRESENCE_INTERVAL_MS = 5_000;
const PRESENCE_STALE_MS = 12_000;
const NULL_VALUE_SENTINEL = '\u0000__null__';
/**
 * Hard ceiling on how long a phase-1 barrier may wait for slow peers,
 * even after `onWaitingForPeers` has fired and the originator is
 * showing a loading indicator. A peer that doesn't ack within this
 * window is treated as broken (e.g. unmounted mid-flight or crashed)
 * and the barrier force-resolves so the remaining demos can commit
 * instead of hanging the UI forever. A `console.warn` flags the
 * incident so it's diagnosable.
 */
const ULTIMATE_TIMEOUT_MS = 10_000;

type DemoId = string;
type BarrierKey = string;

type CoordinatorMessageType = 'announce' | 'ready' | 'presence' | 'leave';

interface CoordinatorMessage {
  type: CoordinatorMessageType;
  demoId: DemoId;
  /** Target value the message refers to. Null is encoded as a sentinel. */
  key: BarrierKey;
  /** Wall-clock (`Date.now()`) anchor for deadline alignment. */
  t: number;
}

interface BarrierWaiter {
  demoId: DemoId;
  onCommit: () => void;
  /**
   * Optional callback fired once when `announceTime + minWaitMs +
   * gracePeriodMs` elapses with the barrier still unresolved. Only
   * supplied by originators (the demo whose user click triggered the
   * change) so they can surface a 'waiting for peers' indicator
   * locally. Peers don't need this — they're the slow ones the
   * originator is waiting on.
   */
  onWaitingForPeers?: () => void;
}

interface PendingBarrier {
  key: BarrierKey;
  /** Peers (other instances) expected to ack. Snapshot at open time. */
  expectedPeers: Set<DemoId>;
  /** Demos that have acked for this key (local + remote). */
  acked: Set<DemoId>;
  /** Local waiters whose `onCommit` should fire when barrier resolves. */
  waiters: Set<BarrierWaiter>;
  /**
   * `true` once the minimum-wait window has elapsed. Until then,
   * `maybeResolveBarrier` refuses to fire even if all peers have
   * acked — the swap commit must wait at least this long so the
   * outgoing `.collapse` placeholders have time to play their exit
   * animation. The acks-arrived-but-min-wait-not-passed case is the
   * common path: the local demo precomputes quickly and everyone
   * else is already done; we still hold the commit until the
   * animation window completes.
   */
  minWaitPassed: boolean;
  /** Timer for the minimum-wait window. */
  minWaitTimer: ReturnType<typeof setTimeout>;
  /**
   * Timer for the grace period (min-wait + grace). When it fires, the
   * barrier does NOT force-resolve; instead, originator waiters'
   * `onWaitingForPeers` callbacks run so they can surface a loading
   * indicator. The barrier keeps waiting for peers until either every
   * ack arrives (natural resolve) or `ultimateTimer` expires.
   */
  waitingForPeersTimer: ReturnType<typeof setTimeout>;
  /** `true` once `waitingForPeersTimer` has fired its callbacks. */
  waitingForPeersNotified: boolean;
  /**
   * Absolute safety net. Force-resolves the barrier with a
   * `console.warn` so a broken/unmounted peer can't hang the UI
   * indefinitely. Default `ULTIMATE_TIMEOUT_MS`.
   */
  ultimateTimer: ReturnType<typeof setTimeout>;
}

const coordinators = new Map<string, TransformCoordinator>();

export interface OpenBarrierOptions {
  /**
   * Wall-clock time (`Date.now()`) used to anchor both the minimum-wait
   * window and the hard deadline. Peers receiving the originator's
   * `announce` align their barrier to this timestamp so all demos aim
   * for the same commit moment regardless of when they observed the
   * change.
   */
  announceTime: number;
  /**
   * Minimum time in ms past `announceTime` before the commit fires,
   * even if every peer has already acked. Lines up with the
   * `transformDelay` animation window so the outgoing `.collapse`
   * placeholders have time to expand before the swap. Default 0
   * (commit as soon as everyone is ready).
   */
  minWaitMs?: number;
  /**
   * Time in ms past `minWaitMs` after which `onWaitingForPeers` fires
   * if the barrier still hasn't resolved. The barrier does NOT
   * force-resolve at this point — it keeps waiting up to
   * `ultimateTimeoutMs`. This is the moment the originator should
   * start surfacing a loading indicator. Default 300ms.
   */
  gracePeriodMs?: number;
  /**
   * Absolute ceiling in ms past `announceTime` after which the barrier
   * force-resolves and logs a warning, regardless of outstanding
   * acks. Default `ULTIMATE_TIMEOUT_MS` (10s). Exposed for tests.
   */
  ultimateTimeoutMs?: number;
  /** Called when the barrier resolves. */
  onCommit: () => void;
  /**
   * Called once when `gracePeriodMs` elapses and the barrier hasn't
   * resolved yet. Only originators should supply this; it's the cue
   * to render a 'waiting for peers' indicator. The barrier continues
   * waiting after this fires (no force-resolve).
   */
  onWaitingForPeers?: () => void;
  /**
   * Whether this demo is the originator (the one whose user click
   * triggered the change). Originators additionally broadcast an
   * `announce` message so peers can align their barrier wall-clocks.
   */
  isOriginator: boolean;
  /** Target value the barrier is waiting for. */
  value: string | null;
}

function encodeKey(value: string | null): BarrierKey {
  return value === null ? NULL_VALUE_SENTINEL : value;
}

/**
 * Coordinator instance backing a single storage key. Multiple
 * `useTransformManagement` consumers sharing the same storage key share
 * one coordinator. Each consumer gets its own `DemoId` (set when it
 * registers) and participates in the presence/ack protocol.
 */
export class TransformCoordinator {
  private readonly channel: BroadcastChannel | null;

  private readonly storageKey: string;

  private readonly knownPeers = new Map<DemoId, number>();

  private readonly localDemos = new Set<DemoId>();

  /**
   * Last value each local demo reported as its current `selectedTransform`.
   * Used by `openBarrier` to exclude peers that are already at the target
   * value from `expectedPeers` — those peers won't run a swap effect, so
   * they'd never ack and the originator would hang until the ultimate
   * safety net fires. Demos that haven't reported a value yet are
   * considered "unknown" and included for safety.
   */
  private readonly localValues = new Map<DemoId, string | null>();

  /**
   * At most one pending barrier per target value. A new change to the
   * same value re-uses the existing barrier so peers can dog-pile onto
   * the same wall-clock deadline.
   */
  private readonly pendingBarriers = new Map<BarrierKey, PendingBarrier>();

  /**
   * Most recent `announceTime` (wall-clock `Date.now()`) observed for a
   * given target value, either from a local originator opening a
   * barrier or from a remote `announce` broadcast. Retained past
   * barrier resolution so peers that wake up late (e.g. a slow
   * `usePreference` propagation) can still anchor their swap to the
   * originator's timeline instead of restarting a fresh window.
   * Entries are eligible for replacement by any newer time for the
   * same key and are pruned opportunistically when stale.
   */
  private readonly lastAnnounceTimes = new Map<BarrierKey, number>();

  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storageKey: string) {
    this.storageKey = storageKey;
    if (typeof BroadcastChannel === 'undefined') {
      this.channel = null;
    } else {
      this.channel = new BroadcastChannel(`${CHANNEL_PREFIX}${storageKey}`);
      this.channel.addEventListener('message', this.handleMessage);
    }
  }

  /**
   * Register a demo with this coordinator. Returns an `unregister`
   * function that removes the demo and (when no demos remain) tears
   * down the coordinator entirely.
   */
  register(demoId: DemoId): () => void {
    this.localDemos.add(demoId);
    this.startPresenceTimerIfNeeded();
    this.broadcast({
      type: 'presence',
      demoId,
      key: '',
      t: Date.now(),
    });
    return () => {
      this.localDemos.delete(demoId);
      this.localValues.delete(demoId);
      this.broadcast({
        type: 'leave',
        demoId,
        key: '',
        t: Date.now(),
      });
      // Ack any open barriers on behalf of the leaving demo so we
      // don't block barriers waiting on a peer that has gone away.
      for (const barrier of this.pendingBarriers.values()) {
        if (barrier.expectedPeers.has(demoId)) {
          barrier.expectedPeers.delete(demoId);
        }
        for (const waiter of Array.from(barrier.waiters)) {
          if (waiter.demoId === demoId) {
            barrier.waiters.delete(waiter);
          }
        }
        this.maybeResolveBarrier(barrier);
      }
      if (this.localDemos.size === 0) {
        this.dispose();
      }
    };
  }

  /**
   * Open a barrier for a value. Returns a `cancel` function used when a
   * newer change supersedes this one before its barrier resolves.
   */
  openBarrier(demoId: DemoId, options: OpenBarrierOptions): () => void {
    const {
      announceTime,
      minWaitMs = 0,
      gracePeriodMs = 300,
      ultimateTimeoutMs = ULTIMATE_TIMEOUT_MS,
      onCommit,
      onWaitingForPeers,
      isOriginator,
      value,
    } = options;
    const key = encodeKey(value);

    if (isOriginator) {
      this.recordAnnounceTime(key, announceTime);
    }

    let barrier = this.pendingBarriers.get(key);
    if (!barrier) {
      // Seed `expectedPeers` with both remote peers (from
      // `BroadcastChannel` presence) *and* local sibling demos
      // registered in this process. Local peers haven't joined as
      // waiters yet — their `useTransformManagement` effects run
      // after the `usePreference` broadcast propagates, typically
      // tens to hundreds of ms behind the originator. Including them
      // in `expectedPeers` keeps the barrier open until they ack, so
      // every phase-1 demo (originator included) commits in the same
      // microtask. Without this, the originator's barrier resolves
      // alone at `minWait` expiry and local peers open a second,
      // late-running barrier — visibly drifting the page.
      const expectedPeers = new Set<DemoId>(this.knownPeers.keys());
      for (const localDemo of this.localDemos) {
        if (localDemo === demoId) {
          continue;
        }
        // Skip peers we know are already at the target value: they
        // won't open a barrier or ack, and waiting on them would
        // hang the originator until the ultimate safety-net fires.
        // Peers whose value is unknown (not yet reported) are
        // included for safety — they'll typically report and/or ack
        // shortly.
        const peerValue = this.localValues.get(localDemo);
        if (peerValue !== undefined && encodeKey(peerValue) === key) {
          continue;
        }
        expectedPeers.add(localDemo);
      }
      const now = Date.now();
      const minRemaining = Math.max(0, announceTime + minWaitMs - now);
      const waitingRemaining = Math.max(
        minRemaining,
        announceTime + minWaitMs + gracePeriodMs - now,
      );
      const ultimateRemaining = Math.max(waitingRemaining, announceTime + ultimateTimeoutMs - now);
      const created: PendingBarrier = {
        key,
        expectedPeers,
        acked: new Set(),
        waiters: new Set(),
        minWaitPassed: minRemaining === 0,
        waitingForPeersNotified: false,
        minWaitTimer: setTimeout(() => {
          const current = this.pendingBarriers.get(key);
          if (!current) {
            return;
          }
          current.minWaitPassed = true;
          this.maybeResolveBarrier(current);
        }, minRemaining),
        waitingForPeersTimer: setTimeout(() => {
          this.notifyWaitingForPeers(key);
        }, waitingRemaining),
        ultimateTimer: setTimeout(() => {
          const current = this.pendingBarriers.get(key);
          if (!current) {
            return;
          }
           
          console.warn(
            `[docs-infra/transform] Barrier for storage key '${this.storageKey}' (value '${key === NULL_VALUE_SENTINEL ? 'null' : key}') force-resolved after ${ultimateTimeoutMs}ms; ` +
              `${current.expectedPeers.size - current.acked.size} peer(s) never acked. ` +
              `This usually means a peer unmounted or crashed mid-transform.`,
          );
          this.forceResolveBarrier(key);
        }, ultimateRemaining),
      };
      barrier = created;
      this.pendingBarriers.set(key, barrier);
    }

    const waiter: BarrierWaiter = { demoId, onCommit, onWaitingForPeers };
    barrier.waiters.add(waiter);

    // Self-ack the opener when its last-reported `localValue` already
    // matches the target. This covers two cases:
    //   1. Originators: their `setLocalValue` effect runs before the
    //      swap effect on the same render (declared earlier in the
    //      hook), so `localValues[demoId]` is already the target when
    //      `openBarrier` is called. Without this, the originator is
    //      only acked via the deferred precompute `scheduleTask`,
    //      which may be cancelled or delayed — leaving the originator
    //      waiter unacked and hanging the barrier to the ultimate
    //      safety net.
    //   2. Phase-1 / phase-2 peers: same effect ordering applies, so
    //      this also makes their explicit `acknowledge` call later in
    //      the swap effect redundant (but harmless and idempotent).
    const openerValue = this.localValues.get(demoId);
    if (openerValue !== undefined && encodeKey(openerValue) === key) {
      this.recordAck(demoId, key);
    }

    // If the grace period already elapsed before this waiter joined
    // (e.g. originator opened, grace fired, then a late peer opened),
    // fire its `onWaitingForPeers` now so originators that join after
    // the boundary still get the cue.
    if (barrier.waitingForPeersNotified && onWaitingForPeers) {
      try {
        onWaitingForPeers();
      } catch {
        // Swallow per-waiter errors.
      }
    }

    if (isOriginator) {
      this.broadcast({
        type: 'announce',
        demoId,
        key,
        t: announceTime,
      });
    }

    this.maybeResolveBarrier(barrier);

    const currentBarrier = barrier;
    return () => {
      currentBarrier.waiters.delete(waiter);
      if (currentBarrier.waiters.size === 0) {
        const stillPending = this.pendingBarriers.get(currentBarrier.key);
        if (stillPending === currentBarrier) {
          clearTimeout(currentBarrier.minWaitTimer);
          clearTimeout(currentBarrier.waitingForPeersTimer);
          clearTimeout(currentBarrier.ultimateTimer);
          this.pendingBarriers.delete(currentBarrier.key);
        }
      }
    };
  }

  /**
   * Fire originator waiters' `onWaitingForPeers` callbacks. Called
   * once per barrier when the grace period expires with peers still
   * outstanding. The barrier itself keeps waiting — only the
   * ultimate timeout force-resolves.
   */
  private notifyWaitingForPeers(key: BarrierKey): void {
    const barrier = this.pendingBarriers.get(key);
    if (!barrier || barrier.waitingForPeersNotified) {
      return;
    }
    barrier.waitingForPeersNotified = true;
    for (const waiter of barrier.waiters) {
      if (!waiter.onWaitingForPeers) {
        continue;
      }
      try {
        waiter.onWaitingForPeers();
      } catch {
        // Swallow per-waiter errors so one bad consumer can't
        // block siblings.
      }
    }
  }

  /**
   * Record a local demo's current `selectedTransform`. Called by
   * `useTransformManagement` whenever the demo's resolved intent
   * changes (including initial mount). The coordinator uses this to
   * exclude peers already at a barrier's target from `expectedPeers`,
   * and to implicitly ack any open barrier whose key matches the new
   * value (the peer would otherwise never open its own barrier or
   * ack, since no swap is scheduled).
   */
  setLocalValue(demoId: DemoId, value: string | null): void {
    this.localValues.set(demoId, value);
    const key = encodeKey(value);
    const barrier = this.pendingBarriers.get(key);
    if (barrier && barrier.expectedPeers.has(demoId) && !barrier.acked.has(demoId)) {
      // Peer is now (already) at the target — satisfy the barrier on
      // its behalf. No broadcast: remote peers don't track our local
      // bookkeeping, and a `ready` here would be misleading (no swap
      // happened).
      this.recordAck(demoId, key);
    }
  }

  /**
   * Mark a demo as READY for a value. Broadcasts to peers and updates
   * the local barrier's ack set.
   */
  acknowledge(demoId: DemoId, value: string | null): void {
    const key = encodeKey(value);
    this.broadcast({
      type: 'ready',
      demoId,
      key,
      t: Date.now(),
    });
    this.recordAck(demoId, key);
  }

  private recordAck(demoId: DemoId, key: BarrierKey): void {
    const barrier = this.pendingBarriers.get(key);
    if (!barrier) {
      return;
    }
    if (!barrier.expectedPeers.has(demoId) && !this.localDemos.has(demoId)) {
      barrier.expectedPeers.add(demoId);
    }
    barrier.acked.add(demoId);
    this.maybeResolveBarrier(barrier);
  }

  private maybeResolveBarrier(barrier: PendingBarrier): void {
    if (!barrier.minWaitPassed) {
      return;
    }
    for (const peer of barrier.expectedPeers) {
      if (!barrier.acked.has(peer)) {
        return;
      }
    }
    for (const waiter of barrier.waiters) {
      if (!barrier.acked.has(waiter.demoId)) {
        return;
      }
    }
    this.forceResolveBarrier(barrier.key);
  }

  private forceResolveBarrier(key: BarrierKey): void {
    const barrier = this.pendingBarriers.get(key);
    if (!barrier) {
      return;
    }
    clearTimeout(barrier.minWaitTimer);
    clearTimeout(barrier.waitingForPeersTimer);
    clearTimeout(barrier.ultimateTimer);
    this.pendingBarriers.delete(key);
    for (const waiter of barrier.waiters) {
      try {
        waiter.onCommit();
      } catch {
        // Swallow per-waiter errors so one bad consumer can't block
        // siblings from committing.
      }
    }
  }

  private handleMessage = (event: MessageEvent<CoordinatorMessage>): void => {
    const msg = event.data;
    if (!msg || this.localDemos.has(msg.demoId)) {
      return;
    }
    this.knownPeers.set(msg.demoId, Date.now());

    switch (msg.type) {
      case 'announce':
        // Record the originator's wall-clock so the local hook's
        // subsequent `openBarrier` call (driven by the slower
        // `usePreference` propagation) can anchor its barrier to the
        // originator's timeline via `getEffectiveAnnounceTime`.
        this.recordAnnounceTime(msg.key, msg.t);
        break;
      case 'ready':
        this.recordAck(msg.demoId, msg.key);
        break;
      case 'leave':
        this.knownPeers.delete(msg.demoId);
        for (const barrier of this.pendingBarriers.values()) {
          if (barrier.expectedPeers.has(msg.demoId)) {
            barrier.expectedPeers.delete(msg.demoId);
            this.maybeResolveBarrier(barrier);
          }
        }
        break;
      case 'presence':
        // Already touched above.
        break;
      default:
        break;
    }
  };

  private startPresenceTimerIfNeeded(): void {
    if (this.presenceTimer !== null || !this.channel) {
      return;
    }
    this.presenceTimer = setInterval(() => {
      const now = Date.now();
      for (const [peer, lastSeen] of this.knownPeers) {
        if (now - lastSeen > PRESENCE_STALE_MS) {
          this.knownPeers.delete(peer);
          for (const barrier of this.pendingBarriers.values()) {
            if (barrier.expectedPeers.has(peer)) {
              barrier.expectedPeers.delete(peer);
              this.maybeResolveBarrier(barrier);
            }
          }
        }
      }
      for (const demoId of this.localDemos) {
        this.broadcast({
          type: 'presence',
          demoId,
          key: '',
          t: now,
        });
      }
    }, PRESENCE_INTERVAL_MS);
  }

  /**
   * Returns the most recent observed `announceTime` for a value, or
   * `fallback` when no entry exists or the stored entry is older than
   * `maxAgeMs` (default 5s — far longer than any reasonable barrier
   * window but short enough that long-idle stored times don't pollute
   * a fresh interaction).
   */
  getEffectiveAnnounceTime(value: string | null, fallback: number, maxAgeMs = 5_000): number {
    const key = encodeKey(value);
    const stored = this.lastAnnounceTimes.get(key);
    if (stored === undefined) {
      return fallback;
    }
    if (Date.now() - stored > maxAgeMs) {
      this.lastAnnounceTimes.delete(key);
      return fallback;
    }
    // Prefer whichever announce happened first — the originator's
    // wall-clock is the authoritative anchor for everyone else.
    return Math.min(stored, fallback);
  }

  private recordAnnounceTime(key: BarrierKey, announceTime: number): void {
    // Each fresh interaction must overwrite the prior entry so peers
    // align to the *current* originator's timeline. Keeping the older
    // timestamp would leave a stale anchor in place for the 5s
    // freshness window: a repeat-switch to the same value within that
    // window would have late peers commit against the previous
    // interaction's deadline (often already in the past), skipping
    // the coordinated delay entirely. Picking the max also resolves
    // concurrent originators of the same value to a single shared
    // anchor (whichever announced last).
    const existing = this.lastAnnounceTimes.get(key);
    if (existing === undefined || announceTime > existing) {
      this.lastAnnounceTimes.set(key, announceTime);
    }
  }

  private broadcast(message: CoordinatorMessage): void {
    if (!this.channel) {
      return;
    }
    try {
      this.channel.postMessage(message);
    } catch {
      // Channel might be closed mid-teardown; ignore.
    }
  }

  private dispose(): void {
    if (this.presenceTimer !== null) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    for (const barrier of this.pendingBarriers.values()) {
      clearTimeout(barrier.minWaitTimer);
      clearTimeout(barrier.waitingForPeersTimer);
      clearTimeout(barrier.ultimateTimer);
    }
    this.pendingBarriers.clear();
    this.lastAnnounceTimes.clear();
    this.knownPeers.clear();
    this.localDemos.clear();
    this.localValues.clear();
    if (this.channel) {
      this.channel.removeEventListener('message', this.handleMessage);
      this.channel.close();
    }
    coordinators.delete(this.storageKey);
  }
}

/** Get or create the coordinator for a storage key. */
export function getTransformCoordinator(storageKey: string): TransformCoordinator {
  let existing = coordinators.get(storageKey);
  if (!existing) {
    existing = new TransformCoordinator(storageKey);
    coordinators.set(storageKey, existing);
  }
  return existing;
}

/** Test-only helper to wipe all coordinators between cases. */
export function resetTransformCoordinatorsForTests(): void {
  for (const coordinator of Array.from(coordinators.values())) {
    (coordinator as unknown as { dispose: () => void }).dispose();
  }
  coordinators.clear();
}

/**
 * Schedule a unit of work to run when the browser is idle, with a
 * timeout fallback so the work always completes within `timeoutMs`.
 * Returns a `cancel` function. On the server (no `window`), runs the
 * callback synchronously — there is no DOM to wait for.
 */
export function scheduleIdle(callback: () => void, timeoutMs = 200): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  const cic = (
    window as unknown as {
      cancelIdleCallback?: (handle: number) => void;
    }
  ).cancelIdleCallback;
  if (typeof ric === 'function') {
    const handle = ric(callback, { timeout: timeoutMs });
    return () => {
      if (typeof cic === 'function') {
        cic(handle);
      }
    };
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

/**
 * Schedule a unit of work to run in a *separate task* as soon as the
 * current task yields, without waiting for the browser to be idle.
 * Used for transform precomputation, where `scheduleIdle` is too
 * pessimistic: under main-thread pressure the idle slot may never
 * arrive within the coordinator's grace window, but precompute is
 * exactly the kind of CPU-bound work that needs to finish before the
 * commit can fire. `postTask` (and the `setTimeout` fallback) runs at
 * user-blocking priority on the next macrotask boundary.
 *
 * Prefers `scheduler.postTask` (modern browsers, supports cancellation
 * via `AbortController`); falls back to `setTimeout(fn, 0)` everywhere
 * else (older browsers, jsdom, SSR). The fallback's ~4ms clamp on
 * nested timers is irrelevant here — precompute is scheduled at most
 * once per transform, not in a tight loop. On the server runs the
 * callback synchronously.
 */
export function scheduleTask(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }
  const postTask = (
    globalThis as unknown as {
      scheduler?: {
        postTask?: (
          cb: () => void,
          opts?: {
            priority?: 'user-blocking' | 'user-visible' | 'background';
            signal?: AbortSignal;
          },
        ) => Promise<unknown>;
      };
    }
  ).scheduler?.postTask;
  if (typeof postTask === 'function' && typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    postTask(callback, { priority: 'user-blocking', signal: controller.signal }).catch(() => {
      // Swallow `AbortError` raised by cancellation.
    });
    return () => controller.abort();
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

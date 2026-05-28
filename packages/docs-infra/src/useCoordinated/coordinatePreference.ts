/**
 * Generic same-tab preference coordinator. Its primary purpose is
 * to **fold many concurrent value changes into a single layout-shift
 * commit**: sibling component instances that share a `channelKey`
 * coordinate so the visible flip happens together rather than as a
 * cascade of independent re-layouts.
 *
 * Each peer self-classifies a given target value via
 * `causesLayoutShift` (consulted for non-originator peers only;
 * originators always take the barrier path so a user click always
 * feels coordinated):
 *
 *   - **`causesLayoutShift(target) === true`** — the peer joins a
 *     channel-wide barrier. Every joining peer's `preload` runs
 *     serially across the channel (so no main-thread contention
 *     while we prepare the swap), and all `onCommit`s fire together
 *     in a single microtask once everyone is ready. Use for changes
 *     that visibly resize content (collapse/expand, code transforms,
 *     image swaps with different aspect ratios).
 *   - **`causesLayoutShift(target) === false`** — the peer runs its
 *     `preload`+`commit` on its own self-serial chain. Multiple
 *     peers' lazy chains run concurrently with each other and with
 *     any in-flight barrier. Use for changes that are visually
 *     non-disruptive (e.g. updating a value that only shows on hover).
 *
 * Different peers may classify the same target differently — each
 * peer's classification governs only that peer's path through the
 * coordinator.
 *
 * **Cross-tab behavior is intentionally out of scope.** Tabs sync via
 * the underlying state primitive (`useLocalStorageState` etc.); this
 * coordinator only handles peers in the same JS context. A receiving
 * tab independently runs its own barrier across its local peers,
 * which is sequenced naturally after the originator's commit because
 * the originator defers the underlying `setValue` write until its
 * own barrier commits (see `useCoordinated`).
 *
 * No React, no DOM, no BroadcastChannel — pure module-scoped state
 * suitable for any state primitive.
 *
 * **Browser-only.** All state (channels, barriers, lazy queues) is
 * held in module scope and would persist across requests if this
 * module were ever evaluated in a long-lived server-side runtime.
 * The consuming surface is the `useCoordinated` React hook, whose
 * `registerPeer`/`announceTarget` calls are gated behind
 * `useLayoutEffect`/event handlers and therefore never reached
 * during SSR. Do not import this module from server-side code
 * paths that fan out per request.
 */

/** Identifier assigned to each peer at registration time. */
export type PeerId = string;

/** Channel scope. Peers sharing a `channelKey` coordinate with each other. */
export type ChannelKey = string;

/**
 * Sentinel returned by the coordinator's `announceTarget` when no
 * commit is needed for this peer (e.g. its current value already
 * matches the target). Always-defined to keep the API ergonomic.
 */
export interface AnnounceHandle {
  /**
   * Abort a pending announcement (e.g. before the preload has run, or
   * before the barrier has resolved). After `cancel()` no `onCommit`
   * fires for this peer.
   */
  cancel(): void;
  /**
   * Resolves when this peer's `onCommit` has fired or the announcement
   * has been cancelled. Useful for tests and for callers that want to
   * `await` a settled coordination.
   */
  settled: Promise<void>;
}

export interface AnnounceOptions<TValue, TPreload> {
  /**
   * Per-target classifier consulted for **non-originator peers only**.
   * Return `true` when applying this target would visibly shift
   * layout — the peer will join the channel-wide barrier so all
   * such peers commit together. Return `false` for non-disruptive
   * changes — the peer will commit lazily on its own self-serial
   * chain. Originators (the peer the user is directly interacting
   * with) always take the barrier path regardless of this
   * classifier, so a click always feels coordinated with whichever
   * peers join. Different peers may classify the same target
   * differently.
   */
  causesLayoutShift: (target: TValue) => boolean;
  /**
   * Per-peer preload work. The returned value is handed back to
   * `onCommit`. Receives an `AbortSignal` that fires if the
   * announcement is cancelled (e.g. superseded by a newer target).
   * Barrier peers run their `preload` in serial across the channel;
   * lazy peers run their own self-serial chain. May be omitted for
   * pure value-flip use cases.
   */
  preload?: (target: TValue, signal: AbortSignal) => TPreload | Promise<TPreload>;
  /**
   * Fired when this peer's slice of the coordination has settled.
   * For the barrier path this is inside the batched commit (all
   * barrier peers' `onCommit`s run in the same microtask). For the
   * lazy path this is immediately after this peer's own preload
   * completes.
   *
   * `preloaded` may be `undefined` even when `preload` was provided:
   *  - the barrier force-resolved at `ultimateTimeoutMs` before this
   *    peer's slow preload settled,
   *  - the preload threw (logged via `console.error`, treated as a
   *    no-op so the rest of the channel still commits), or
   *  - the preload returned `undefined`/no value.
   *
   * A superseded announce does not call this `onCommit` — the
   * superseding announce takes over and only its `onCommit` runs.
   *
   * Callers must tolerate `preloaded === undefined` and fall back to
   * a synchronous render path (or skip the side effect entirely)
   * rather than throwing.
   */
  onCommit: (target: TValue, preloaded: TPreload | undefined) => void;
  /**
   * Minimum wall-clock time before commit, measured from
   * `announceTime`. On the barrier path: the barrier stays open at
   * least this long so consumers can play an exit animation on the
   * outgoing state. On the lazy path: the per-peer self-serial chain
   * waits at least this long after `announceTime` (anchored, not
   * relative to when preload resolves) so a non-layout-shift peer
   * can land its swap on the same wall-clock window as a sibling
   * barrier instead of cascading. Default 0.
   */
  minWaitMs?: number;
  /**
   * Additional wait applied to `minWaitMs` on the barrier path when
   * more than one peer is registered on the channel at the time the
   * barrier opens. Lets callers express "no extra delay when this
   * demo is alone, but give late siblings a frame to join when they
   * exist" without leaking solo-peer churn through a baseline
   * `minWaitMs`. Default 0.
   */
  multiPeerExtraMinWaitMs?: number;
  /**
   * Overrides `minWaitMs` for the lazy path only. Useful when
   * non-layout-shift peers should land their swap *after* the
   * sibling barrier has finished its expand-swap-collapse window
   * (e.g. `2 * minWaitMs`) so the page settles in one paint instead
   * of cascading. Falls back to `minWaitMs` when unset.
   */
  lazyMinWaitMs?: number;
  /**
   * Lazy-path opt-in: when a same-target barrier is pending at the
   * moment this peer announces, run its `preload` concurrently with
   * the barrier's preloads instead of waiting for the barrier to
   * commit. Use only for I/O-bound preloads that don't tax the main
   * thread (e.g. fetching a JSON payload) — main-thread-heavy
   * preloads (parsing, highlighting, layout measurement) should
   * leave this `false` so the barrier's layout-shifting peers get
   * uncontended CPU time to settle their swap.
   *
   * The lazy peer's `onCommit` still waits until the render after
   * the barrier commits, regardless of this flag — the visible flip
   * never lands before the layout-shifting siblings have painted.
   *
   * No effect when no barrier exists at announce time (the lazy
   * pipeline runs immediately on its own clock).
   *
   * Default `false`.
   */
  preloadAll?: boolean;
  /**
   * Time past `minWaitMs` after which `onWaitingForPeers` fires if
   * the barrier still hasn't resolved. The barrier itself keeps
   * waiting up to `ultimateTimeoutMs`. Default 300ms.
   */
  gracePeriodMs?: number;
  /**
   * Absolute ceiling past announcement after which the barrier
   * force-resolves and logs a warning, regardless of outstanding
   * peers. Default 10s.
   */
  ultimateTimeoutMs?: number;
  /**
   * Called once when `gracePeriodMs` elapses with the barrier still
   * unresolved. Only meaningful for originators (the peer that the
   * user is directly interacting with) so they can surface a
   * "waiting for peers" indicator.
   */
  onWaitingForPeers?: () => void;
  /**
   * Whether this peer originated the change (user click) versus
   * received it from elsewhere (storage event from another tab). Only
   * affects which peer's `onWaitingForPeers` may fire and which peer
   * opens the channel-wide barrier.
   */
  isOriginator: boolean;
  /** Wall-clock anchor (`Date.now()`) for barrier timers. */
  announceTime: number;
}

const DEFAULT_MIN_WAIT_MS = 0;
const DEFAULT_GRACE_PERIOD_MS = 300;
const DEFAULT_ULTIMATE_TIMEOUT_MS = 10_000;

/**
 * Detects a browser-like host. Used by the public entry points to
 * no-op when the module is reached outside the browser. The
 * consuming `useCoordinated` hook already gates its calls behind
 * `useLayoutEffect` and event handlers (which never run on the
 * server), but this is defense-in-depth: a stray non-effect caller
 * would otherwise leak module-state across SSR requests as warned
 * in the file header. Detection runs once at module-evaluation time
 * — re-evaluating per call would pessimize the hot path and the
 * runtime can't switch between server and browser mid-process.
 */
const IS_BROWSER_HOST = typeof window !== 'undefined' && typeof document !== 'undefined';

const NOOP_UNREGISTER: () => void = () => {};
const NOOP_ANNOUNCE_HANDLE: AnnounceHandle = {
  cancel: () => {},
  settled: Promise.resolve(),
};

/**
 * Fired on a registered peer when *another* peer in the same channel
 * calls `announceTarget`. Lets a peer learn about a sibling-driven
 * change without having to wait for the underlying state primitive
 * (e.g. `useLocalStorageState`) to echo the new value back — that
 * echo only happens after the originator commits, which itself is
 * gated on every sibling joining the barrier. Without this hook
 * sibling peers would deadlock the barrier until
 * `ultimateTimeoutMs` for any same-tab coordination where the
 * underlying primitive only notifies after the originator's write.
 *
 * Implementations should typically call into their local equivalent
 * of `runCoordination(target, isOriginator=false)` so the peer
 * joins the active barrier (or kicks off its own lazy chain on the
 * same wall-clock window). Implementations must be idempotent for
 * repeated calls with the same `target` because notifications can
 * fan out from each subsequent join.
 */
export type OnSiblingAnnounce<TValue> = (target: TValue) => void;

interface RegisteredPeer<TValue> {
  id: PeerId;
  /**
   * Last value this peer reported via `reportValue`. Used to skip
   * peers that are already at the target when classifying barrier
   * expectations. Initialized lazily on first `reportValue`.
   */
  currentValue: { has: false } | { has: true; value: TValue };
  /**
   * Optional notifier invoked when *another* peer on the channel
   * announces a target. See {@link OnSiblingAnnounce}.
   */
  onSiblingAnnounce?: OnSiblingAnnounce<TValue>;
  /**
   * In-flight lazy-path work, keyed by the AbortController used to
   * cancel it. The value is the target each entry is committing to,
   * so barrier creation can selectively skip a peer only when its
   * pending lazy work matches the new barrier's target.
   * Cancelled when the peer is unregistered or a new lazy-path
   * announcement supersedes a still-queued one.
   */
  lazyInFlight: Map<AbortController, TValue>;
  /**
   * Per-peer serialization queue for lazy-path announcements. Each
   * entry is a starter callback that kicks off its preload + commit
   * pipeline. We drain via callback chaining (not Promise.then) so
   * the entire pipeline stays on macrotasks — important for tests
   * driving fake timers without microtask drains.
   */
  lazyQueue: Array<() => void>;
  lazyActive: boolean;
}

interface BarrierWaiter<TValue, TPreload> {
  peerId: PeerId;
  isOriginator: boolean;
  preloaded: { has: false } | { has: true; value: TPreload | undefined };
  onCommit: (target: TValue, preloaded: TPreload | undefined) => void;
  onWaitingForPeers?: () => void;
  /** Resolves the waiter's `settled` promise. */
  settle: () => void;
  /** Cancel handle for the waiter's enqueued preload work. */
  abort: AbortController;
}

interface PendingBarrier<TValue, TPreload> {
  target: TValue;
  /**
   * Wall-clock anchor (`Date.now()`) recorded when the barrier was
   * opened. Used by {@link getBarrierAnnounceTime} so late-joining
   * peers can align their local timers to the originator's window
   * instead of restarting a fresh one.
   */
  announceTime: number;
  /**
   * Peers expected to participate. Set when the barrier opens and on
   * each waiter join (peers register themselves as they classify the
   * target as 'high'). The barrier resolves when every expected peer
   * has its `preloaded` field populated AND the minimum wait has
   * elapsed.
   */
  waiters: Map<PeerId, BarrierWaiter<TValue, TPreload>>;
  /**
   * Peers that explicitly opted out of this barrier by taking the
   * lazy path for the same `target`. The barrier may resolve once
   * `waiters.size + skipped.size >= channel.peers.size`.
   */
  skipped: Set<PeerId>;
  /** `true` once the minimum-wait timer has fired. */
  minWaitPassed: boolean;
  minWaitTimer: ReturnType<typeof setTimeout>;
  waitingForPeersTimer: ReturnType<typeof setTimeout>;
  waitingForPeersNotified: boolean;
  ultimateTimer: ReturnType<typeof setTimeout>;
  ultimateTimeoutMs: number;
  /**
   * Callbacks queued by lazy peers that announced the same target
   * while this barrier was pending. Fired one macrotask after every
   * waiter's `onCommit` runs, so the lazy peers' commits land in
   * the render *after* the barrier's batched commit — keeping the
   * main thread clear while the layout-shifting siblings paint.
   */
  deferredLazyReleases: Array<() => void>;
}

interface Channel<TValue> {
  channelKey: ChannelKey;
  peers: Map<PeerId, RegisteredPeer<TValue>>;
  /**
   * `true` once any peer has called `announceTarget` on this channel
   * since the channel was created. Surfaced by
   * {@link hasEverAnnounced} so callers can distinguish "first
   * paint, nobody has interacted" from "someone interacted then
   * everyone settled". Never reset — a channel that's been
   * announced on and then emptied will still report `true` until
   * its last peer unregisters and the channel disposes.
   */
  hasEverAnnounced: boolean;
  /**
   * Channel-wide serial queue for barrier-path preloads. Each barrier-path
   * announcement appends its preload work; only one preload runs at a
   * time across all this-tab barrier-path peers, preventing main-thread
   * contention when many sibling demos all need to precompute.
   */
  barrierTail: Promise<unknown>;
  /**
   * At most one pending barrier-path barrier per encoded target value.
   * Keyed by the result of `encodeTarget` so any hashable target
   * works.
   */
  pendingBarriers: Map<string, PendingBarrier<TValue, unknown>>;
}

const channels = new Map<ChannelKey, Channel<unknown>>();

/**
 * Override hook for tests that need a deterministic target encoder
 * (e.g. when the value type contains unstable references). Production
 * callers should leave this alone — the default `JSON.stringify` is
 * sufficient for primitive and plain-object values.
 */
let encodeTargetImpl: (value: unknown) => string = (value) => {
  if (value === null) {
    return '\u0000null';
  }
  if (value === undefined) {
    return '\u0000undefined';
  }
  if (typeof value === 'string') {
    return `s:${value}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `p:${String(value)}`;
  }
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `o:${Object.prototype.toString.call(value)}`;
  }
};

/**
 * Set a custom target encoder. Returns a function that restores the
 * previous encoder. Intended for tests; consumed via
 * `coordinatePreference.testUtils`.
 */
function setTargetEncoder(impl: (value: unknown) => string): () => void {
  const previous = encodeTargetImpl;
  encodeTargetImpl = impl;
  return () => {
    encodeTargetImpl = previous;
  };
}

function encodeTarget(value: unknown): string {
  return encodeTargetImpl(value);
}

function getOrCreateChannel<TValue>(channelKey: ChannelKey): Channel<TValue> {
  let channel = channels.get(channelKey) as Channel<TValue> | undefined;
  if (!channel) {
    channel = {
      channelKey,
      peers: new Map(),
      hasEverAnnounced: false,
      barrierTail: Promise.resolve(),
      pendingBarriers: new Map(),
    };
    channels.set(channelKey, channel as Channel<unknown>);
  }
  return channel;
}

function disposeChannelIfEmpty(channel: Channel<unknown>): void {
  if (channel.peers.size === 0 && channel.pendingBarriers.size === 0) {
    channels.delete(channel.channelKey);
  }
}

/**
 * Register a peer with a channel. Returns an `unregister` function
 * that removes the peer; calling it cancels any in-flight lazy-path
 * work owned by the peer and drops it from any open barrier-path barriers.
 *
 * Pass `onSiblingAnnounce` to learn about target announcements made
 * by other peers on the channel — this is what lets a peer join the
 * originator's barrier window without waiting for the underlying
 * state primitive to echo the new value (which only happens after
 * the originator commits, creating a deadlock when every peer is
 * waiting on it).
 */
export function registerPeer<TValue>(
  channelKey: ChannelKey,
  peerId: PeerId,
  onSiblingAnnounce?: OnSiblingAnnounce<TValue>,
): () => void {
  if (!IS_BROWSER_HOST) {
    return NOOP_UNREGISTER;
  }
  const channel = getOrCreateChannel<TValue>(channelKey);
  if (channel.peers.has(peerId)) {
    throw /* minify-error */ new Error(
      `coordinatePreference: peer '${peerId}' is already registered on channel '${channelKey}'. ` +
        'Each peer must have a unique id within a channel. ' +
        'See https://mui.com/r/docs-infra-coordinate-preference for more info.',
    );
  }
  const peer: RegisteredPeer<TValue> = {
    id: peerId,
    currentValue: { has: false },
    onSiblingAnnounce: onSiblingAnnounce as OnSiblingAnnounce<TValue> | undefined,
    lazyInFlight: new Map(),
    lazyQueue: [],
    lazyActive: false,
  };
  channel.peers.set(peerId, peer);
  return () => {
    const stillPresent = channel.peers.get(peerId);
    if (stillPresent !== peer) {
      return;
    }
    channel.peers.delete(peerId);
    for (const controller of peer.lazyInFlight.keys()) {
      controller.abort();
    }
    peer.lazyInFlight.clear();
    peer.lazyQueue.length = 0;
    peer.lazyActive = false;
    // Drop this peer from any open barriers and re-check resolution.
    // We must also clear it from `skipped` so a later replacement peer
    // registering with the same coordinates isn't silently "covered"
    // by the stale entry — the quorum check counts
    // `waiters + skipped` against the current peer set, so a leftover
    // skipped id could let a barrier commit without the new peer ever
    // joining. We re-check every barrier (not just ones the peer was
    // a waiter on) because shrinking `channel.peers.size` can make a
    // barrier resolvable even when the departing peer had only
    // registered and never joined — otherwise the barrier would sit
    // open until the next unrelated event or the ultimate timeout.
    for (const barrier of channel.pendingBarriers.values()) {
      const waiter = barrier.waiters.get(peerId);
      if (waiter) {
        waiter.abort.abort();
        barrier.waiters.delete(peerId);
      }
      barrier.skipped.delete(peerId);
      maybeResolveBarrier(channel, barrier);
    }
    disposeChannelIfEmpty(channel as Channel<unknown>);
  };
}

/**
 * Report a peer's current value to the coordinator. Used to exclude
 * already-at-target peers from barrier expectations.
 */
export function reportValue<TValue>(
  channelKey: ChannelKey,
  peerId: PeerId,
  currentValue: TValue,
): void {
  const channel = channels.get(channelKey) as Channel<TValue> | undefined;
  if (!channel) {
    return;
  }
  const peer = channel.peers.get(peerId);
  if (!peer) {
    return;
  }
  peer.currentValue = { has: true, value: currentValue };

  // A peer that is already committed to an open barrier's target does
  // not need to announce again. Mark it as satisfied so the barrier
  // doesn't wait for a no-op receiver flow that will never run.
  for (const barrier of channel.pendingBarriers.values()) {
    if (barrier.waiters.has(peerId)) {
      continue;
    }
    if (!Object.is(barrier.target, currentValue)) {
      continue;
    }
    barrier.skipped.add(peerId);
    maybeResolveBarrier(channel, barrier);
  }
}

/**
 * Announce a target value for this peer. Routes into the barrier or
 * lazy path based on `causesLayoutShift(target)`.
 *
 * For the barrier path: the peer joins the channel-wide barrier for
 * this target (creating it if needed), enqueues its `preload` into
 * the channel's serial queue, and awaits the barrier's batched
 * commit.
 *
 * For the lazy path: the peer enqueues `preload` + `onCommit` onto
 * its own self-serial chain and returns immediately. Multiple peers'
 * lazy chains run concurrently with each other and with any
 * in-flight barrier work.
 */
export function announceTarget<TValue, TPreload>(
  channelKey: ChannelKey,
  peerId: PeerId,
  target: TValue,
  options: AnnounceOptions<TValue, TPreload>,
): AnnounceHandle {
  if (!IS_BROWSER_HOST) {
    return NOOP_ANNOUNCE_HANDLE;
  }
  const channel = getOrCreateChannel<TValue>(channelKey);
  const peer = channel.peers.get(peerId);
  if (!peer) {
    throw /* minify-error */ new Error(
      `coordinatePreference: peer '${peerId}' is not registered on channel '${channelKey}'. ` +
        'Call `registerPeer` before `announceTarget`. ' +
        'See https://mui.com/r/docs-infra-coordinate-preference for more info.',
    );
  }
  if (options.isOriginator || options.causesLayoutShift(target)) {
    channel.hasEverAnnounced = true;
    const handle = joinOrOpenBarrier(channel, peer, target, options);
    notifySiblings(channel, peer, target);
    return handle;
  }
  channel.hasEverAnnounced = true;
  const handle = enqueueLazy(channel, peer, target, options);
  notifySiblings(channel, peer, target);
  return handle;
}

/**
 * Synchronously fan out a target announcement to every other peer on
 * the channel whose state is known to differ from the target (or
 * whose state is unknown). Peers that have already joined the active
 * barrier for this target (as waiter or skipped) are excluded so we
 * don't re-enter their `runCoordination` and cancel the in-flight
 * announcement we're about to satisfy.
 *
 * This is the within-tab analogue of cross-tab storage echoes: it
 * lets sibling peers join the originator's barrier window before the
 * originator has written through to the underlying state primitive.
 * Without it, two sibling peers sharing a `useLocalStorageState` (or
 * any other primitive that only fires on commit) would deadlock the
 * barrier until `ultimateTimeoutMs`.
 */
function notifySiblings<TValue>(
  channel: Channel<TValue>,
  announcer: RegisteredPeer<TValue>,
  target: TValue,
): void {
  if (channel.peers.size <= 1) {
    return;
  }
  const barrierKey = encodeTarget(target);
  const barrier = channel.pendingBarriers.get(barrierKey);
  // Snapshot the peer list first — a callback may register or
  // unregister peers reentrantly which would invalidate live iteration.
  const siblings: Array<RegisteredPeer<TValue>> = [];
  for (const otherPeer of channel.peers.values()) {
    if (otherPeer.id === announcer.id) {
      continue;
    }
    if (!otherPeer.onSiblingAnnounce) {
      continue;
    }
    if (otherPeer.currentValue.has && Object.is(otherPeer.currentValue.value, target)) {
      continue;
    }
    if (barrier && (barrier.waiters.has(otherPeer.id) || barrier.skipped.has(otherPeer.id))) {
      continue;
    }
    siblings.push(otherPeer);
  }
  for (const otherPeer of siblings) {
    try {
      otherPeer.onSiblingAnnounce!(target);
    } catch (err) {
      console.error(
        `[docs-infra/coordinatePreference] onSiblingAnnounce for peer '${otherPeer.id}' on channel ` +
          `'${channel.channelKey}' threw:`,
        err,
      );
    }
  }
}

function joinOrOpenBarrier<TValue, TPreload>(
  channel: Channel<TValue>,
  peer: RegisteredPeer<TValue>,
  target: TValue,
  options: AnnounceOptions<TValue, TPreload>,
): AnnounceHandle {
  const barrierKey = encodeTarget(target);
  let barrier = channel.pendingBarriers.get(barrierKey) as
    | PendingBarrier<TValue, TPreload>
    | undefined;
  const announceTime = options.announceTime;
  const minWaitMs =
    (options.minWaitMs ?? DEFAULT_MIN_WAIT_MS) +
    (channel.peers.size > 1 ? (options.multiPeerExtraMinWaitMs ?? 0) : 0);
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const ultimateTimeoutMs = options.ultimateTimeoutMs ?? DEFAULT_ULTIMATE_TIMEOUT_MS;

  if (!barrier) {
    const now = Date.now();
    const minRemaining = Math.max(0, announceTime + minWaitMs - now);
    const waitingRemaining = Math.max(minRemaining, announceTime + minWaitMs + gracePeriodMs - now);
    const ultimateRemaining = Math.max(waitingRemaining, announceTime + ultimateTimeoutMs - now);
    const created: PendingBarrier<TValue, TPreload> = {
      target,
      announceTime,
      waiters: new Map(),
      skipped: new Set(),
      minWaitPassed: minRemaining === 0,
      minWaitTimer: setTimeout(() => {
        const current = channel.pendingBarriers.get(barrierKey);
        if (!current || current !== (barrier as unknown)) {
          return;
        }
        current.minWaitPassed = true;
        maybeResolveBarrier(channel, current);
      }, minRemaining),
      waitingForPeersTimer: setTimeout(() => {
        notifyWaitingForPeers(channel, barrierKey);
      }, waitingRemaining),
      waitingForPeersNotified: false,
      ultimateTimer: setTimeout(() => {
        const current = channel.pendingBarriers.get(barrierKey);
        if (!current) {
          return;
        }

        console.warn(
          `[docs-infra/coordinatePreference] Barrier on channel '${channel.channelKey}' ` +
            `force-resolved after ${ultimateTimeoutMs}ms; ` +
            `${current.waiters.size} waiter(s) still pending. ` +
            'A peer likely unmounted or crashed mid-preload.',
        );
        forceResolveBarrier(channel, barrierKey);
      }, ultimateRemaining),
      ultimateTimeoutMs,
      deferredLazyReleases: [],
    };
    barrier = created;
    channel.pendingBarriers.set(barrierKey, barrier as PendingBarrier<TValue, unknown>);
    // Peers that already routed to the lazy path for *this same
    // target* shouldn't gate the new barrier — they'll commit
    // lazily on their own clock and we'd otherwise wait for a peer
    // that has no intention of joining. Crucially, we must NOT skip
    // a peer whose pending lazy work is for a *different* target:
    // the upcoming `notifySiblings` call will pull that peer onto
    // the new barrier, but if the barrier is also zero-wait with a
    // synchronous originator preload it can `maybeResolveBarrier`
    // before that notification runs, leaving the peer stranded on
    // the wrong value.
    for (const otherPeer of channel.peers.values()) {
      if (otherPeer.id === peer.id) {
        continue;
      }
      if (otherPeer.currentValue.has && Object.is(otherPeer.currentValue.value, target)) {
        created.skipped.add(otherPeer.id);
        continue;
      }
      for (const lazyTarget of otherPeer.lazyInFlight.values()) {
        if (Object.is(lazyTarget, target)) {
          created.skipped.add(otherPeer.id);
          break;
        }
      }
    }
  }

  let settleResolver: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    settleResolver = resolve;
  });

  const abort = new AbortController();
  const waiter: BarrierWaiter<TValue, TPreload> = {
    peerId: peer.id,
    isOriginator: options.isOriginator,
    preloaded: { has: false },
    onCommit: options.onCommit,
    onWaitingForPeers: options.onWaitingForPeers,
    settle: settleResolver,
    abort,
  };
  barrier.waiters.set(peer.id, waiter);
  barrier.skipped.delete(peer.id);

  // If grace already fired, fire this waiter's onWaitingForPeers now
  // so late originators still get the cue.
  if (barrier.waitingForPeersNotified && waiter.onWaitingForPeers && waiter.isOriginator) {
    try {
      waiter.onWaitingForPeers();
    } catch {
      // Swallow per-waiter errors.
    }
  }

  // Run preload now. When no other peer on this barrier is
  // currently preloading, probe synchronously so the originator's
  // sync preload commits in the same tick (callers inside a sync
  // `act(...)` see the result without flushing microtasks). When a
  // sibling already has an in-flight preload, queue this peer's
  // preload onto the channel's serial barrier tail so each peer's
  // (possibly CPU-bound) preload runs in its own task instead of
  // piling onto the announce-fanout task.
  const preload = options.preload;
  if (!preload) {
    waiter.preloaded = { has: true, value: undefined };
    maybeResolveBarrier(channel, barrier as PendingBarrier<TValue, unknown>);
  } else {
    let othersPending = false;
    for (const other of barrier.waiters.values()) {
      if (other !== waiter && !other.preloaded.has) {
        othersPending = true;
        break;
      }
    }

    const runPreload = async (): Promise<void> => {
      if (abort.signal.aborted) {
        return;
      }
      let value: TPreload | undefined;
      try {
        value = await preload(target, abort.signal);
      } catch (err) {
        if (abort.signal.aborted) {
          return;
        }

        console.error(
          `[docs-infra/coordinatePreference] Preload for peer '${peer.id}' on channel ` +
            `'${channel.channelKey}' threw; treating as no-op. Error:`,
          err,
        );
      }
      if (abort.signal.aborted) {
        return;
      }
      waiter.preloaded = { has: true, value };
      maybeResolveBarrier(channel, barrier as PendingBarrier<TValue, unknown>);
    };

    if (!othersPending) {
      // Probe synchronously. If preload returns a thenable, fold the
      // resulting work onto the channel's barrier tail so the next
      // sibling waits its turn before starting its own preload.
      let probeResult: TPreload | Promise<TPreload> | undefined;
      let probeThrew = false;
      try {
        probeResult = preload(target, abort.signal);
      } catch (err) {
        probeThrew = true;

        console.error(
          `[docs-infra/coordinatePreference] Preload for peer '${peer.id}' on channel ` +
            `'${channel.channelKey}' threw; treating as no-op. Error:`,
          err,
        );
      }
      const isThenable =
        !probeThrew &&
        probeResult !== null &&
        typeof probeResult === 'object' &&
        typeof (probeResult as PromiseLike<TPreload>).then === 'function';
      if (!isThenable) {
        if (!abort.signal.aborted) {
          waiter.preloaded = {
            has: true,
            value: probeThrew ? undefined : (probeResult as TPreload | undefined),
          };
          maybeResolveBarrier(channel, barrier as PendingBarrier<TValue, unknown>);
        }
      } else {
        const probePromise = probeResult as Promise<TPreload>;
        // Swallow the rejection on the original promise so an
        // unhandled-rejection warning doesn't fire while we wait
        // our turn on the queue.
        probePromise.catch(() => undefined);
        const settleProbe = probePromise.then(
          async (value) => {
            if (abort.signal.aborted) {
              return;
            }
            waiter.preloaded = { has: true, value };
            maybeResolveBarrier(channel, barrier as PendingBarrier<TValue, unknown>);
          },
          (err) => {
            if (abort.signal.aborted) {
              return;
            }

            console.error(
              `[docs-infra/coordinatePreference] Preload for peer '${peer.id}' on channel ` +
                `'${channel.channelKey}' threw; treating as no-op. Error:`,
              err,
            );
            waiter.preloaded = { has: true, value: undefined };
            maybeResolveBarrier(channel, barrier as PendingBarrier<TValue, unknown>);
          },
        );
        channel.barrierTail = settleProbe.catch(() => undefined);
      }
    } else {
      const previousTail = channel.barrierTail;
      const myTurn = previousTail.then(runPreload);
      channel.barrierTail = myTurn.catch(() => undefined);
    }
  }

  return {
    cancel: () => {
      abort.abort();
      const stillPending = channel.pendingBarriers.get(barrierKey);
      if (
        stillPending &&
        stillPending === (barrier as unknown as PendingBarrier<TValue, unknown>)
      ) {
        stillPending.waiters.delete(peer.id);
        if (stillPending.waiters.size === 0) {
          clearTimeout(stillPending.minWaitTimer);
          clearTimeout(stillPending.waitingForPeersTimer);
          clearTimeout(stillPending.ultimateTimer);
          channel.pendingBarriers.delete(barrierKey);
          disposeChannelIfEmpty(channel as Channel<unknown>);
        } else {
          maybeResolveBarrier(channel, stillPending);
        }
      }
      settleResolver();
    },
    settled,
  };
}

function notifyWaitingForPeers<TValue>(channel: Channel<TValue>, barrierKey: string): void {
  const barrier = channel.pendingBarriers.get(barrierKey);
  if (!barrier || barrier.waitingForPeersNotified) {
    return;
  }
  barrier.waitingForPeersNotified = true;
  for (const waiter of barrier.waiters.values()) {
    if (!waiter.onWaitingForPeers || !waiter.isOriginator) {
      continue;
    }
    try {
      waiter.onWaitingForPeers();
    } catch {
      // Swallow per-waiter errors.
    }
  }
}

function maybeResolveBarrier<TValue>(
  channel: Channel<TValue>,
  barrier: PendingBarrier<TValue, unknown>,
): void {
  if (!barrier.minWaitPassed) {
    return;
  }
  // Wait for every *registered* peer on this channel to join the
  // barrier, not just the ones that have already announced. A peer
  // that registered (`registerPeer`) but hasn't yet announced a
  // target is still expected to participate — resolving without it
  // would let the originator commit early and break lockstep.
  // The barrier's `ultimateTimer` is the safety net for a peer that
  // never joins (crashed / unmounted mid-precompute).
  if (barrier.waiters.size + barrier.skipped.size < channel.peers.size) {
    return;
  }
  for (const waiter of barrier.waiters.values()) {
    if (!waiter.preloaded.has) {
      return;
    }
  }
  const barrierKey = encodeTarget(barrier.target);
  forceResolveBarrier(channel, barrierKey);
}

function forceResolveBarrier<TValue>(channel: Channel<TValue>, barrierKey: string): void {
  const barrier = channel.pendingBarriers.get(barrierKey);
  if (!barrier) {
    return;
  }
  clearTimeout(barrier.minWaitTimer);
  clearTimeout(barrier.waitingForPeersTimer);
  clearTimeout(barrier.ultimateTimer);
  channel.pendingBarriers.delete(barrierKey);
  // Fire all onCommits in the same microtask so React batches them.
  for (const waiter of barrier.waiters.values()) {
    const preloaded = waiter.preloaded.has ? waiter.preloaded.value : undefined;
    try {
      waiter.onCommit(barrier.target, preloaded);
    } catch (err) {
      console.error(
        `[docs-infra/coordinatePreference] onCommit for peer '${waiter.peerId}' on channel ` +
          `'${channel.channelKey}' threw:`,
        err,
      );
    }
    waiter.settle();
  }
  // Release any lazy peers that were gated on this barrier. The
  // macrotask hop puts their commits in the *render after* the
  // barrier's batched commit — keeping the main thread clear while
  // the layout-shifting siblings paint, and ensuring the visible
  // flip on the lazy peers never beats the barrier siblings to the
  // DOM.
  const releases = barrier.deferredLazyReleases;
  if (releases.length > 0) {
    setTimeout(() => {
      for (const release of releases) {
        try {
          release();
        } catch (err) {
          console.error(
            `[docs-infra/coordinatePreference] deferred lazy release on channel ` +
              `'${channel.channelKey}' threw:`,
            err,
          );
        }
      }
    }, 0);
  }
  disposeChannelIfEmpty(channel as Channel<unknown>);
}

function enqueueLazy<TValue, TPreload>(
  channel: Channel<TValue>,
  peer: RegisteredPeer<TValue>,
  target: TValue,
  options: AnnounceOptions<TValue, TPreload>,
): AnnounceHandle {
  // Barrier-coordination is resolved inside `gateStart` below (one
  // microtask after enqueue) so a barrier opened by a sibling peer
  // in the same sync flush is observable before we route.
  let settleResolver: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    settleResolver = resolve;
  });
  const abort = new AbortController();
  peer.lazyInFlight.set(abort, target);

  const lazyWait = options.lazyMinWaitMs ?? options.minWaitMs ?? 0;

  // Per-peer serialization: callbacks for preload, timer, and commit
  // are kicked off only when this peer's lazy queue reaches us. We
  // chain via callbacks (not Promise.then) so the entire pipeline
  // stays on macrotasks and can be driven by `vi.advanceTimersByTime`
  // without manual microtask drains.
  let preloaded: TPreload | undefined;
  let preloadDone = !options.preload;
  let preloadStarted = false;
  let preloadAwaiters: Array<() => void> = [];

  const drainNext = () => {
    const next = peer.lazyQueue.shift();
    if (next) {
      next();
    } else {
      peer.lazyActive = false;
    }
  };

  const finishCancelled = () => {
    peer.lazyInFlight.delete(abort);
    settleResolver();
    drainNext();
  };

  const doCommit = () => {
    if (abort.signal.aborted) {
      finishCancelled();
      return;
    }
    try {
      options.onCommit(target, preloaded);
    } catch (err) {
      console.error(
        `[docs-infra/coordinatePreference] lazy-path onCommit for peer '${peer.id}' on channel ` +
          `'${channel.channelKey}' threw:`,
        err,
      );
    }
    peer.lazyInFlight.delete(abort);
    settleResolver();
    drainNext();
  };

  const scheduleIdleCommit = () => {
    if (abort.signal.aborted) {
      doCommit();
      return;
    }
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const cic = (globalThis as { cancelIdleCallback?: (handle: number) => void })
      .cancelIdleCallback;
    if (typeof ric === 'function') {
      const handle = ric(doCommit);
      abort.signal.addEventListener('abort', () => {
        if (typeof cic === 'function') {
          cic(handle);
        }
      });
    } else {
      doCommit();
    }
  };

  const onTimerFired = () => {
    if (abort.signal.aborted) {
      doCommit();
      return;
    }
    if (preloadDone) {
      scheduleIdleCommit();
    } else {
      preloadAwaiters.push(scheduleIdleCommit);
    }
  };

  const startPreload = () => {
    if (preloadStarted) {
      return;
    }
    preloadStarted = true;
    if (!options.preload) {
      preloadDone = true;
      return;
    }
    let preloadResult: TPreload | Promise<TPreload> | undefined;
    try {
      preloadResult = options.preload(target, abort.signal);
    } catch (err) {
      console.error(
        `[docs-infra/coordinatePreference] lazy-path preload for peer '${peer.id}' on channel ` +
          `'${channel.channelKey}' threw; treating as no-op. Error:`,
        err,
      );
      preloadDone = true;
    }
    if (
      preloadResult !== undefined &&
      preloadResult !== null &&
      typeof (preloadResult as { then?: unknown }).then === 'function'
    ) {
      (preloadResult as Promise<TPreload>).then(
        (value) => {
          preloaded = value;
          preloadDone = true;
          const awaiters = preloadAwaiters;
          preloadAwaiters = [];
          for (const fn of awaiters) {
            fn();
          }
        },
        (err) => {
          console.error(
            `[docs-infra/coordinatePreference] lazy-path preload for peer '${peer.id}' on channel ` +
              `'${channel.channelKey}' threw; treating as no-op. Error:`,
            err,
          );
          preloadDone = true;
          const awaiters = preloadAwaiters;
          preloadAwaiters = [];
          for (const fn of awaiters) {
            fn();
          }
        },
      );
    } else if (preloadResult !== undefined) {
      preloaded = preloadResult as TPreload;
      preloadDone = true;
    }
  };

  const startTimerAndCommit = () => {
    if (lazyWait > 0) {
      const timer = setTimeout(onTimerFired, lazyWait);
      abort.signal.addEventListener('abort', () => clearTimeout(timer));
    } else {
      onTimerFired();
    }
  };

  const runPipeline = () => {
    if (abort.signal.aborted) {
      finishCancelled();
      return;
    }
    startPreload();
    startTimerAndCommit();
  };

  // Decide barrier-gating one microtask after enqueue. By then any
  // sibling peer that announced a barrier on the same sync flush has
  // opened its barrier, so we can route consistently regardless of
  // hook-declaration order.
  const gateStart = () => {
    if (abort.signal.aborted) {
      finishCancelled();
      return;
    }
    const barrierKey = encodeTarget(target);
    const existingBarrier = channel.pendingBarriers.get(barrierKey);
    if (!existingBarrier) {
      runPipeline();
      return;
    }
    // A same-target barrier is pending. Push our deferred release
    // FIRST so that if `maybeResolveBarrier` (called below)
    // synchronously force-resolves the barrier, our release is
    // included in its `setTimeout` schedule. Then mark this peer as
    // skipped and (optionally) overlap our preload with the
    // barrier's via `preloadAll`. The barrier fires the deferred
    // releases one macrotask after its batched commit so the
    // visible flip on the lazy peers lands in the render *after*
    // the layout-shifting barrier siblings have updated the DOM.
    existingBarrier.deferredLazyReleases.push(() => {
      if (abort.signal.aborted) {
        finishCancelled();
        return;
      }
      if (preloadStarted) {
        startTimerAndCommit();
      } else {
        runPipeline();
      }
    });
    if (!existingBarrier.waiters.has(peer.id)) {
      existingBarrier.skipped.add(peer.id);
      maybeResolveBarrier(channel, existingBarrier);
    }
    if (options.preloadAll) {
      startPreload();
    }
  };

  const enqueueEntry = () => {
    // If a same-target barrier is already open at enqueue time (the
    // common case: this lazy announce was triggered by an
    // originator's `notifySiblings` immediately after they opened
    // the barrier), join it synchronously. Waiting one microtask
    // would let the originator's `minWaitTimer` fire first under
    // faked timers (`queueMicrotask` is faked by vitest), at which
    // point `maybeResolveBarrier` would see `skipped.size === 0`
    // and force-resolve only the originator's waiter — leaving us
    // stranded. The microtask path below still covers the
    // hook-declaration-order case where the barrier hasn't opened
    // yet by the time we enqueue.
    const barrierKey = encodeTarget(target);
    if (channel.pendingBarriers.has(barrierKey)) {
      gateStart();
      return;
    }
    queueMicrotask(gateStart);
  };

  if (peer.lazyActive) {
    peer.lazyQueue.push(enqueueEntry);
  } else {
    peer.lazyActive = true;
    enqueueEntry();
  }

  return {
    cancel: () => {
      abort.abort();
      peer.lazyInFlight.delete(abort);
      settleResolver();
      // If this was queued but never started, remove it from the
      // queue so the next caller's `start` actually runs. If it had
      // already started, the in-flight setTimeout/preload paths will
      // call `drainNext` themselves when they observe `aborted`.
      const idx = peer.lazyQueue.indexOf(enqueueEntry);
      if (idx !== -1) {
        peer.lazyQueue.splice(idx, 1);
      }
    },
    settled,
  };
}

/**
 * Returns `true` if any peer has ever called `announceTarget` on this
 * channel since the channel was created (i.e., since the first peer
 * registered without an existing channel object). Useful for
 * first-render reconciliation: a peer that wakes up post-hydration
 * and finds the channel "fresh" (no announcements yet) can safely
 * fast-forward its committed value to the latest underlying value
 * without going through a barrier, because no peer is mid-animation.
 *
 * Returns `false` when the channel doesn't exist (no peers have
 * registered yet) or exists but hasn't seen an announce.
 */
export function hasEverAnnounced(channelKey: ChannelKey): boolean {
  const channel = channels.get(channelKey);
  return channel ? channel.hasEverAnnounced : false;
}

/**
 * Returns the `announceTime` recorded when the active barrier for
 * `target` was opened, or `null` if no barrier is currently pending
 * for that target on `channelKey`. Late-joining peers can use this
 * to anchor their local timers to the originator's wall-clock window
 * instead of restarting a fresh one \u2014 e.g. a peer whose state
 * propagated 200ms after the originator's click should commit 200ms
 * earlier than its local `Date.now()` would suggest, so the visible
 * paint lines up.
 */
export function getBarrierAnnounceTime<TValue>(
  channelKey: ChannelKey,
  target: TValue,
): number | null {
  const channel = channels.get(channelKey);
  if (!channel) {
    return null;
  }
  const barrierKey = encodeTarget(target);
  const barrier = channel.pendingBarriers.get(barrierKey);
  return barrier ? barrier.announceTime : null;
}

/**
 * Internal handles for the `coordinatePreference.testUtils` sibling.
 *
 * Not part of the public API. Do not import this from production
 * code or from tests directly — use the helpers re-exported from
 * `./coordinatePreference.testUtils` instead so that the boundary
 * between runtime API and test affordances stays clear.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention, no-underscore-dangle -- intentional sentinel name marking this as a test-only sibling import
export const __testInternals = {
  channels,
  setTargetEncoder,
};

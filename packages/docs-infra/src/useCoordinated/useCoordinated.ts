'use client';
import * as React from 'react';
import {
  registerPeer,
  reportValue,
  announceTarget,
  getBarrierAnnounceTime,
  type ChannelKey,
  type PeerId,
  type AnnounceHandle,
} from './coordinatePreference';

/**
 * Options for {@link useCoordinated}. See `coordinatePreference` for
 * the underlying semantics; only React-specific behaviors are
 * documented here.
 */
export interface UseCoordinatedOptions<TValue, TPreload> {
  /**
   * Coordination scope. All peers (component instances) that share a
   * `channelKey` participate in the same layout-shift barrier. Pass
   * `null` to opt out of coordination entirely (the hook becomes a
   * plain pass-through of the underlying `[value, setValue]`).
   */
  channelKey: ChannelKey | null;
  /**
   * Stable identifier for *this* peer within the channel. Defaults to
   * a freshly generated id on mount. Override when stable cross-mount
   * identity matters (e.g. for analytics / debugging).
   */
  peerId?: PeerId;
  /**
   * Return `true` when applying this target would visibly shift
   * layout — the peer joins the channel-wide barrier so all such
   * peers commit together. Return `false` for non-disruptive changes
   * — the peer commits lazily on its own self-serial chain. See
   * `coordinatePreference` for the full semantics.
   */
  causesLayoutShift: (target: TValue) => boolean;
  /**
   * Optional async work to run before the barrier commits (for
   * `causesLayoutShift === true`) or before a lazy commit (for
   * `false`). The resolved value is handed to `onCommit`.
   */
  preload?: (target: TValue, signal: AbortSignal) => TPreload | Promise<TPreload>;
  /**
   * Hook fired inside the coordinated commit, before the visible
   * value flips. Useful for installing precomputed payloads into
   * neighboring state. The visible `value` returned from this hook
   * always lags `pendingValue` until coordination settles, so this
   * runs *with* the value flip, not before it.
   *
   * Also fires once on first mount, with the initial preloaded
   * payload, so consumers can install precomputed state on hydration
   * without a separate code path.
   *
   * Under normal conditions `preloaded` is whatever this peer's
   * `preload` resolved to. It may still be `undefined` when:
   *  - the barrier force-resolved at `ultimateTimeoutMs` (a sibling
   *    peer crashed / hung; accompanied by a console warning),
   *  - `preload` threw (logged via `console.error`, treated as a
   *    no-op so the rest of the channel still commits), or
   *  - `preload` explicitly returned `undefined`.
   *
   * Handlers should tolerate the undefined case and fall back to a
   * synchronous render path rather than throwing.
   */
  onCommit?: (target: TValue, preloaded: TPreload | undefined) => void;
  /**
   * See {@link AnnounceOptions.minWaitMs}.
   */
  minWaitMs?: number;
  /**
   * See {@link AnnounceOptions.multiPeerExtraMinWaitMs}.
   */
  multiPeerExtraMinWaitMs?: number;
  /**
   * See {@link AnnounceOptions.lazyMinWaitMs}.
   */
  lazyMinWaitMs?: number;
  /**
   * See {@link AnnounceOptions.gracePeriodMs}.
   */
  gracePeriodMs?: number;
  /**
   * See {@link AnnounceOptions.ultimateTimeoutMs}.
   */
  ultimateTimeoutMs?: number;
}

export interface UseCoordinatedExtras<TValue> {
  /**
   * The most recently announced target value. Equals the committed
   * `value` when no coordination is in flight. Useful for showing an
   * optimistic preview UI (toolbar selection, etc.) that should react
   * instantly to a click even when the visible content has a pending
   * barrier.
   */
  pendingValue: TValue;
  /**
   * `true` while this peer's preload is in flight or the layout-shift
   * barrier is open. Surfaces as `data-coordinating` on consumers.
   */
  isCoordinating: boolean;
  /**
   * `true` once the grace period has elapsed with the barrier still
   * unresolved. Only set on the originating peer. Surface as a
   * "waiting" affordance to the user.
   */
  isWaitingForPeers: boolean;
}

let nextAutoPeerId = 0;
function generatePeerId(): PeerId {
  nextAutoPeerId += 1;
  return `peer-${nextAutoPeerId}`;
}

/**
 * Coordinate a piece of state across sibling component instances on
 * the same channel, so that visually disruptive value changes commit
 * in a single layout pass rather than independently. Designed as a
 * thin wrapper around any `useState`-shaped primitive (e.g.
 * `useLocalStorageState`, `usePreference`, plain `useState`).
 *
 * **Originator flow** — calling the returned `setValue`:
 *   1. `pendingValue` updates synchronously to the requested target
 *   2. The coordinator runs `preload` (per phase rules) and waits for
 *      sibling peers (phase 1 only)
 *   3. When the barrier resolves, the underlying `setValue` is called
 *      and this hook's visible `value` flips, so the swap is
 *      consistent with the optional `onCommit` side-effect
 *
 * **Receiver flow** — when the underlying `value` changes from outside
 * (e.g. a storage event from another tab):
 *   1. `pendingValue` updates to match
 *   2. Coordination runs locally (this tab's peers run their own
 *      phase-1 barrier)
 *   3. The visible `value` returned by this hook is held at the
 *      previous value until the barrier resolves, then flips
 *
 * Pass `channelKey: null` to disable coordination — the hook becomes
 * a transparent pass-through of the underlying tuple.
 */
export function useCoordinated<TValue, TPreload = void>(
  underlying: [TValue, (next: TValue) => void],
  options: UseCoordinatedOptions<TValue, TPreload>,
): [TValue, React.Dispatch<React.SetStateAction<TValue>>, UseCoordinatedExtras<TValue>] {
  const [underlyingValue, setUnderlyingValue] = underlying;
  const {
    channelKey,
    peerId: explicitPeerId,
    causesLayoutShift,
    preload,
    onCommit,
    minWaitMs,
    multiPeerExtraMinWaitMs,
    lazyMinWaitMs,
    gracePeriodMs,
    ultimateTimeoutMs,
  } = options;

  // Stable peer id for the lifetime of the mounted component.
  const peerIdRef = React.useRef<PeerId | null>(null);
  if (peerIdRef.current === null) {
    peerIdRef.current = explicitPeerId ?? generatePeerId();
  } else if (explicitPeerId !== undefined && explicitPeerId !== peerIdRef.current) {
    peerIdRef.current = explicitPeerId;
  }
  const peerId = peerIdRef.current;

  // The visible (committed) value. Lags `underlyingValue` while a
  // phase-1 barrier is open in the receiver flow.
  const [committedValue, setCommittedValue] = React.useState<TValue>(underlyingValue);
  // The latest target value (originator click or external change).
  const [pendingValue, setPendingValue] = React.useState<TValue>(underlyingValue);
  const [isCoordinating, setIsCoordinating] = React.useState(false);
  const [isWaitingForPeers, setIsWaitingForPeers] = React.useState(false);

  // Keep latest callbacks in a ref so we don't re-register the peer
  // when the consumer passes inline functions.
  const callbacksRef = React.useRef({
    causesLayoutShift,
    preload,
    onCommit,
    setUnderlyingValue,
  });
  callbacksRef.current.causesLayoutShift = causesLayoutShift;
  callbacksRef.current.preload = preload;
  callbacksRef.current.onCommit = onCommit;
  callbacksRef.current.setUnderlyingValue = setUnderlyingValue;

  const timingRef = React.useRef({
    minWaitMs,
    multiPeerExtraMinWaitMs,
    lazyMinWaitMs,
    gracePeriodMs,
    ultimateTimeoutMs,
  });
  timingRef.current.minWaitMs = minWaitMs;
  timingRef.current.multiPeerExtraMinWaitMs = multiPeerExtraMinWaitMs;
  timingRef.current.lazyMinWaitMs = lazyMinWaitMs;
  timingRef.current.gracePeriodMs = gracePeriodMs;
  timingRef.current.ultimateTimeoutMs = ultimateTimeoutMs;

  // In-flight handle so we can cancel/supersede.
  const handleRef = React.useRef<AnnounceHandle | null>(null);
  // Track the value we last asked the underlying primitive to take —
  // when we see it echoed back via `underlyingValue` we skip the
  // receiver flow so we don't double-coordinate our own writes.
  const lastWrittenRef = React.useRef<{ has: false } | { has: true; value: TValue }>({
    has: false,
  });
  // The latest target the coordinator is working on; used to dedupe
  // re-entrant effect runs when `underlyingValue` changes mid-flight.
  const inFlightTargetRef = React.useRef<{ has: false } | { has: true; value: TValue }>({
    has: false,
  });

  // Forward-declared ref so the peer registration's `onSiblingAnnounce`
  // can call the latest `runCoordination` without re-registering the
  // peer every time the callback identity changes.
  const runCoordinationRef = React.useRef<((target: TValue, isOriginator: boolean) => void) | null>(
    null,
  );
  // Register / unregister this peer with the channel.
  React.useInsertionEffect(() => {
    if (channelKey === null) {
      return undefined;
    }
    const unregister = registerPeer<TValue>(channelKey, peerId, (target) => {
      runCoordinationRef.current?.(target, false);
    });
    reportValue(channelKey, peerId, committedValue);
    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) {
        handle.cancel();
      }
      inFlightTargetRef.current = { has: false };
      unregister();
    };
  }, [channelKey, peerId]);

  // Tell the coordinator our latest committed value so it can skip
  // already-at-target peers when classifying barrier expectations.
  React.useInsertionEffect(() => {
    if (channelKey === null) {
      return;
    }
    reportValue(channelKey, peerId, committedValue);
  }, [channelKey, peerId, committedValue]);

  const runCoordination = React.useCallback(
    (target: TValue, isOriginator: boolean) => {
      if (channelKey === null) {
        // Keep `inFlightTargetRef` in sync so two synchronous calls
        // like `setValue(p => p + 1); setValue(p => p + 1)` see the
        // freshest base — `setPendingValue` is async, so the second
        // updater would otherwise read the pre-render value and
        // collapse to a single increment. The receiver-flow effect
        // resets the ref on every external `underlyingValue` change,
        // and `runCoordination` overwrites it on every subsequent
        // call, so this won't leak across coordination cycles.
        inFlightTargetRef.current = { has: true, value: target };
        setPendingValue(target);
        setCommittedValue(target);
        if (isOriginator) {
          lastWrittenRef.current = { has: true, value: target };
          callbacksRef.current.setUnderlyingValue(target);
        }
        callbacksRef.current.onCommit?.(target, undefined);
        return;
      }
      // Dedupe: if we're already coordinating exactly this target
      // (e.g. a sibling-announce notification arrived after we
      // already kicked off our own receiver-flow announce, our own
      // originator-flow `announceTarget` call is still on the stack,
      // or the user clicked the same value twice in quick
      // succession), skip restarting the announcement. Without this
      // the second call would cancel our in-flight handle and we'd
      // lose our place in the barrier — or, when the dedupe also
      // fires re-entrantly mid-announce, we'd recurse forever.
      if (inFlightTargetRef.current.has && Object.is(inFlightTargetRef.current.value, target)) {
        return;
      }
      // Supersede any in-flight announcement.
      const previousHandle = handleRef.current;
      if (previousHandle) {
        previousHandle.cancel();
      }
      inFlightTargetRef.current = { has: true, value: target };
      setPendingValue(target);
      setIsCoordinating(true);
      setIsWaitingForPeers(false);
      const handle = announceTarget<TValue, TPreload>(channelKey, peerId, target, {
        causesLayoutShift: callbacksRef.current.causesLayoutShift,
        preload: callbacksRef.current.preload,
        onCommit: (committedTarget, preloaded) => {
          // Side-effect first so consumers can install precomputed
          // payloads before the value flip becomes visible.
          callbacksRef.current.onCommit?.(committedTarget, preloaded);
          if (isOriginator) {
            lastWrittenRef.current = { has: true, value: committedTarget };
            callbacksRef.current.setUnderlyingValue(committedTarget);
          }
          setCommittedValue(committedTarget);
          // Clear coordination flags synchronously alongside the
          // value flip so the next render reflects both at once.
          setIsCoordinating(false);
          setIsWaitingForPeers(false);
        },
        minWaitMs: timingRef.current.minWaitMs,
        multiPeerExtraMinWaitMs: timingRef.current.multiPeerExtraMinWaitMs,
        lazyMinWaitMs: timingRef.current.lazyMinWaitMs,
        gracePeriodMs: timingRef.current.gracePeriodMs,
        ultimateTimeoutMs: timingRef.current.ultimateTimeoutMs,
        onWaitingForPeers: () => {
          setIsWaitingForPeers(true);
        },
        isOriginator,
        // Non-originators (e.g. storage echoes) anchor to the
        // originator's announce time if a barrier is already open
        // so late joiners share the same wall-clock deadline.
        announceTime: (!isOriginator && getBarrierAnnounceTime(channelKey, target)) || Date.now(),
      });
      handleRef.current = handle;
      handle.settled.then(() => {
        if (handleRef.current === handle) {
          handleRef.current = null;
          inFlightTargetRef.current = { has: false };
          setIsCoordinating(false);
          setIsWaitingForPeers(false);
        }
      });
    },
    [channelKey, peerId],
  );

  // Keep the ref pointed at the latest `runCoordination` so the
  // peer-registration callback (set once at mount) always invokes
  // the current closure.
  runCoordinationRef.current = runCoordination;

  // Receiver flow: external `underlyingValue` change that we did not
  // originate. Trigger a local coordination so this tab's peers commit
  // together. Uses `useLayoutEffect` so the announcement lands in the
  // same synchronous flush as the originator's broadcast — otherwise
  // a sibling peer's `runCoordination` would slip past whatever
  // `setTimeout` cadence the test (or browser) is driving and miss
  // the originator's barrier window.
  React.useLayoutEffect(() => {
    if (channelKey === null) {
      inFlightTargetRef.current = { has: false };
      setCommittedValue(underlyingValue);
      setPendingValue(underlyingValue);
      return;
    }
    if (lastWrittenRef.current.has) {
      if (Object.is(lastWrittenRef.current.value, underlyingValue)) {
        // Echo of our own write — already coordinated. Treat the
        // sentinel as one-shot: consume it here so a *subsequent*
        // external write that happens to round-trip to the same
        // value (e.g. local→`b`, external→`c`, external→`b`) is
        // recognized as a genuine external change rather than
        // misclassified as another echo.
        lastWrittenRef.current = { has: false };
        return;
      }
      // Sentinel is stale: the underlying moved to something other
      // than what we last wrote, so an earlier no-op originator
      // write (which produced no echo) must have left the sentinel
      // armed. Clear it now so a later external round-trip back to
      // that value isn't suppressed.
      lastWrittenRef.current = { has: false };
    }
    if (
      handleRef.current &&
      inFlightTargetRef.current.has &&
      Object.is(inFlightTargetRef.current.value, underlyingValue) &&
      Object.is(pendingValue, underlyingValue)
    ) {
      // Already coordinating this target.
      return;
    }
    if (Object.is(committedValue, underlyingValue)) {
      // No external change to react to. We deliberately skip running
      // `preload` on mount when the underlying value already matches
      // our committed value: preload only needs to run when the value
      // changes out from under us without the consumer calling the
      // setter (e.g. a hydration write from `localStorage` or a
      // parent state update). After the consumer interacts with the
      // setter, the originator flow drives every cycle.
      return;
    }
    runCoordination(underlyingValue, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, underlyingValue, runCoordination]);

  const coordinatedSetValue = React.useCallback<React.Dispatch<React.SetStateAction<TValue>>>(
    (action) => {
      // Functional updaters need to see the latest target — even
      // before React has re-rendered with the new `pendingValue` —
      // so that bursts like `setValue(p => p + 1); setValue(p => p +
      // 1)` compose to +2 instead of +1. `inFlightTargetRef` is
      // updated synchronously inside `runCoordination` before
      // `announceTarget` runs, so it's the freshest source.
      const base = inFlightTargetRef.current.has ? inFlightTargetRef.current.value : pendingValue;
      const next =
        typeof action === 'function' ? (action as (prev: TValue) => TValue)(base) : action;
      runCoordination(next, true);
    },
    [pendingValue, runCoordination],
  );

  const extras = React.useMemo<UseCoordinatedExtras<TValue>>(
    () => ({ pendingValue, isCoordinating, isWaitingForPeers }),
    [pendingValue, isCoordinating, isWaitingForPeers],
  );

  return [committedValue, coordinatedSetValue, extras];
}

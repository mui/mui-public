import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import {
  getAvailableTransforms,
  getApplicableTransforms,
  createTransformedFiles,
  transformHasCollapsePlaceholder,
} from './useCodeUtils';
import { type CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { usePreference } from '../usePreference';
import { scheduleIdle, scheduleTask, getTransformCoordinator } from './coordinateTransform';

/**
 * Minimum coordinator barrier wait used when `transformDelay` is unset
 * or zero but a layout-shift-prone swap still needs to land on the
 * same frame as peer demos. One animation frame at ~60fps so the
 * coordinated paint feels instantaneous but every peer commits
 * together — otherwise multiple sibling demos on the page would each
 * trigger their own layout shift in sequence.
 */
const MIN_TRANSFORM_WAIT_MS = 16;

interface UseTransformManagementProps {
  context?: CodeHighlighterContextType;
  effectiveCode: Code;
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  initialTransform?: string;
  /**
   * When set to a positive number, the *swap* of `transformedFiles` to the
   * newly-selected transform is delayed by this many milliseconds so
   * consumers can run an exit animation on the currently-rendered tree
   * (notably the collapsed-lines placeholders) before the new tree is
   * committed.
   *
   * `selectedTransform` always updates synchronously to the chosen value
   * so the UI control (radio, toggle, …) reflects the change immediately,
   * whether it originated from a user click in *this* demo or from an
   * external broadcast (another demo on the page, another tab, or an
   * `availableTransforms` / `initialTransform` re-resolution). While the
   * swap is pending or just-committed, `transformingPhase` is non-null
   * and consumers should mark the rendered `<pre>` with
   * `data-transforming={phase}` so CSS can react.
   */
  transformDelay?: number;
  /**
   * Mode passed to `transformHasCollapsePlaceholder` to classify swaps
   * as layout-affecting (phase 1, coordinated) versus non-layout
   * (phase 2). See `useCode`'s `transformLayoutShift` option for
   * details. Defaults to `'all'` to preserve the historical behavior
   * when `selectedFileName` isn't supplied.
   */
  transformLayoutShift?: 'all' | 'selected' | 'focus';
  /**
   * Currently-selected file name. Required for the `'selected'` and
   * `'focus'` `transformLayoutShift` modes; ignored by `'all'`.
   */
  selectedFileName?: string | undefined;
  /**
   * Whether the surrounding code block is currently expanded. Consulted
   * only by `transformLayoutShift: 'focus'`.
   */
  expanded?: boolean;
}

export interface UseTransformManagementResult {
  availableTransforms: string[];
  selectedTransform: string | null;
  transformedFiles: ReturnType<typeof createTransformedFiles>;
  selectTransform: (transformName: string | null) => void;
  /**
   * Direction of the in-flight transform animation, or `null` when
   * settled. Always `null` when `transformDelay` is not set or is `0`.
   *
   *   - `'expand'`   the outgoing transformed tree's `.collapse`
   *                  placeholders should expand back to their original
   *                  height before the swap commits. Set during the
   *                  pre-swap delay for `transform → null` and
   *                  `transform → transform` (first half).
   *   - `'collapse'` the incoming transformed tree's `.collapse`
   *                  placeholders should collapse from their original
   *                  height down to 0. Set during the post-swap window
   *                  for `null → transform` and `transform → transform`
   *                  (second half).
   */
  transformingPhase: 'expand' | 'collapse' | null;
  /**
   * Target of an in-flight transform swap that is waiting on slow
   * peers past the coordinator's grace window (`gracePeriodMs`,
   * default 300ms beyond `transformDelay`). `undefined` when no swap
   * is pending. Otherwise mirrors the shape of `selectedTransform`:
   * `null` for a pending swap back to the un-transformed original,
   * or the transform name for a pending swap to that transform.
   * The commit is *not* force-resolved at this boundary — the barrier
   * keeps waiting up to `ultimateTimeoutMs` (10s) — so consumers can
   * use this value to render a transient loading indicator. Only
   * populated on the demo that originated the change; always
   * `undefined` on peers and when no coordinator is configured.
   */
  pendingTransform: string | null | undefined;
}

/**
 * Hook for managing code transforms and their application
 * Uses the useLocalStorage hook for local storage persistence of transform preferences
 */
export function useTransformManagement({
  context,
  effectiveCode,
  selectedVariantKey,
  selectedVariant,
  initialTransform,
  transformDelay,
  transformLayoutShift,
  selectedFileName,
  expanded,
}: UseTransformManagementProps): UseTransformManagementResult {
  // Transform state - get available transforms from context or from the effective code data
  const availableTransforms = React.useMemo(() => {
    // First try to get from context
    if (context?.availableTransforms && context.availableTransforms.length > 0) {
      return context.availableTransforms;
    }

    // Otherwise, get from the effective code data using the utility function
    return getAvailableTransforms(effectiveCode, selectedVariantKey);
  }, [context?.availableTransforms, effectiveCode, selectedVariantKey]);

  // Broader set used to resolve a stored preference *and* to derive the
  // localStorage key: includes rename-only transforms (manifest entries
  // with `hasDelta: false`) so a user preference like 'js' still applies
  // the `.ts` → `.js` rename even when the toggle is hidden because
  // there's no source-level delta. We always compute this from
  // `effectiveCode` — `context.availableTransforms` is the *visible*
  // toggle list (filtered by `hasDelta`) and is intentionally not used
  // here, otherwise rename-only entries would be dropped from
  // resolution and the storage key would shift whenever a transform's
  // visibility changed between sibling demos.
  const applicableTransforms = React.useMemo(
    () => getApplicableTransforms(effectiveCode, selectedVariantKey),
    [effectiveCode, selectedVariantKey],
  );

  // Coordinator key. Demos sharing the same applicable transform set
  // belong to the same coordination group: a user click in one demo
  // triggers a synchronized barrier across all of them. `null` only
  // when there are no applicable transforms at all (nothing to swap),
  // otherwise we always join — even single-transform demos benefit
  // from coordinating with sibling instances that share the same
  // toggle (e.g. an entire docs page of JS/TS-only demos).
  const coordinatorKey = React.useMemo(
    () => (applicableTransforms.length >= 1 ? [...applicableTransforms].sort().join(':') : null),
    [applicableTransforms],
  );

  // Stable per-hook identity used by the coordinator to track which
  // demos have acked the current barrier. `useState` with a lazy
  // initializer keeps the impure `Math.random()` / `Date.now()` calls
  // outside of render so React rules-of-purity stay happy.
  const [demoId] = React.useState(
    () => `demo-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
  );

  // Shared mutable storage between the rIC precompute callback (writer)
  // and the `transformedFiles` memo (single-use reader). State — not a
  // ref — so the memo can read it during render without violating
  // React's rules-of-hooks. Both this and `setDelayedAppliedTransform`
  // are set inside the barrier's `onCommit` so React batches them into
  // a single re-render.
  const [precomputed, setPrecomputed] = React.useState<{
    variant: VariantCode | null;
    transform: string | null;
    result: ReturnType<typeof createTransformedFiles>;
  } | null>(null);

  // Set to the target transform (`null` for the un-transformed
  // original) once the originator's barrier has crossed the grace
  // window without every peer acking. Reset to `undefined` by the
  // barrier's `onCommit` (whether by ack convergence or by the
  // ultimate safety-net timeout) and by the swap effect's cleanup
  // when a new transition supersedes the current one.
  const [pendingTransform, setPendingTransform] = React.useState<string | null | undefined>(
    undefined,
  );

  // Carries originator metadata (user-click timestamp) into the swap
  // effect that observes the resulting `selectedTransform` change. The
  // effect consumes the ref so a stale flag can't be misapplied to a
  // later non-user-driven change. Keyed by target value so the effect
  // can verify the flag was set for *this* particular change.
  const pendingOriginatorRef = React.useRef<{
    value: string | null;
    announceTime: number;
  } | null>(null);

  // Register with the coordinator while mounted so peers know this
  // demo exists and barriers wait for it. Unregister on unmount or
  // when the coordinator key changes (applicable transforms shifted).
  React.useEffect(() => {
    if (!coordinatorKey) {
      return undefined;
    }
    return getTransformCoordinator(coordinatorKey).register(demoId);
  }, [coordinatorKey, demoId]);

  // Use localStorage hook for transform persistence. localStorage is the
  // cross-demo broadcast channel, but the *current* demo tracks its
  // selection in local React state so a user click applies immediately,
  // before other demos sharing the same storage key re-render. The key
  // is derived from `applicableTransforms` (the full set) so demos with
  // only rename-only transforms still participate in persistence and so
  // a transform becoming rename-only doesn't move it to a different
  // storage bucket.
  const [storedValue, setStoredValue] = usePreference(
    'transform',
    applicableTransforms.length === 1 ? applicableTransforms[0] : applicableTransforms,
    () => {
      // Don't use initialTransform as the fallback - localStorage should always take precedence
      // We'll handle the initial transform separately below
      return null;
    },
  );

  // Defer the storage-driven value so peer demos that receive the
  // broadcast can schedule a low-priority re-render instead of competing
  // for the synchronous commit triggered by `useSyncExternalStore`. The
  // synchronous render that fires for every subscriber sees the *old*
  // deferred value, so nothing downstream of `selectedTransform`
  // recomputes; the actual transform application is committed later as
  // a low-priority transition (one extra commit per demo).
  const deferredStoredValue = React.useDeferredValue(storedValue);

  // Resolve a stored/initial value into a valid transform name (or null).
  // Resolution uses `applicableTransforms` (which includes rename-only
  // entries) so a stored preference can still apply a rename even when
  // the toggle is hidden because no actual code delta exists.
  const resolveTransform = React.useCallback(
    (stored: string | null): string | null => {
      if (stored !== null) {
        if (stored === '') {
          return null;
        }
        if (!applicableTransforms.includes(stored)) {
          return null;
        }
        return stored;
      }
      if (initialTransform && applicableTransforms.includes(initialTransform)) {
        return initialTransform;
      }
      return null;
    },
    [applicableTransforms, initialTransform],
  );

  // Local mirror of the resolved transform. This is the source of truth
  // for *this* demo so user-initiated changes are reflected synchronously
  // in the same render that calls `selectTransform`, before the
  // localStorage broadcast reaches other demos.
  const [localSelectedTransform, setLocalSelectedTransform] = React.useState<string | null>(() =>
    resolveTransform(storedValue),
  );

  // `delayedAppliedTransform` lags `selectedTransform` by the
  // coordinated swap window (see the swap effect below). Declared
  // here — ahead of the sync effect — so the first-render
  // reconciliation can co-commit both state values in the same React
  // render (see the comment on the sync effect for details).
  const [delayedAppliedTransform, setDelayedAppliedTransform] = React.useState<string | null>(
    () => localSelectedTransform,
  );

  // Sync from deferredStoredValue → local when the change originated
  // elsewhere (another demo, another tab, or a change in
  // availableTransforms / initialTransform that re-resolves the value).
  // The update is wrapped in `startTransition` so the peer-demo
  // re-render that applies the new transform is interruptible by
  // higher-priority work (e.g., the user clicking another control).
  //
  // First-render reconciliation special case: when the page hydrates,
  // `useSyncExternalStore` returns `null` (server snapshot) for
  // hydration safety and only switches to the real localStorage value
  // on the first browser render. If that value differs from
  // `initialTransform`, every demo on the page hits this effect with
  // the SAME post-hydration tick — so we also fast-forward
  // `delayedAppliedTransform` to the resolved value in the same
  // render. Setting both state values together makes the swap effect
  // bail out (its first guard is `delayedAppliedTransform ===
  // selectedTransform`), so every demo's initial reconciliation commits
  // in a single React render (no per-demo barrier wait, no inter-demo
  // flicker as each demo independently runs its `transformDelay`
  // window).
  //
  // Peer broadcasts (another demo in the same tab clicked, another
  // tab made a selection) are excluded by checking the coordinator's
  // `hasEverAnnounced()`: any local originator or remote announce
  // populates `lastAnnounceTimes`, so a "fresh" coordinator
  // unambiguously identifies the post-hydration tick. Once anyone has
  // interacted, the regular animated swap path takes over.
  const hasReconciledInitiallyRef = React.useRef(false);
  const prevStoredValueRef = React.useRef(deferredStoredValue);
  const prevResolvedRef = React.useRef(localSelectedTransform);
  React.useEffect(() => {
    const resolved = resolveTransform(deferredStoredValue);
    const storedChanged = prevStoredValueRef.current !== deferredStoredValue;
    const resolvedChanged = prevResolvedRef.current !== resolved;
    prevStoredValueRef.current = deferredStoredValue;
    prevResolvedRef.current = resolved;
    if ((storedChanged || resolvedChanged) && resolved !== localSelectedTransform) {
      const isInitialReconciliation =
        !hasReconciledInitiallyRef.current &&
        (!coordinatorKey || !getTransformCoordinator(coordinatorKey).hasEverAnnounced());
      hasReconciledInitiallyRef.current = true;
      React.startTransition(() => {
        setLocalSelectedTransform(resolved);
        if (isInitialReconciliation) {
          setDelayedAppliedTransform(resolved);
        }
      });
    }
  }, [deferredStoredValue, resolveTransform, localSelectedTransform, coordinatorKey]);

  const selectedTransform = localSelectedTransform;

  // Report this demo's current intent to the coordinator on every
  // change (including the initial mount value). The coordinator uses
  // this to exclude peers that are already at a barrier's target
  // value from `expectedPeers` — otherwise the originator would wait
  // for an ack from a peer that has no swap to coordinate and will
  // never open a barrier of its own. Also implicitly acks any open
  // barrier whose key matches the new value, in case the broadcast
  // arrived before our `setLocalValue` reported the match.
  React.useEffect(() => {
    if (!coordinatorKey) {
      return;
    }
    getTransformCoordinator(coordinatorKey).setLocalValue(demoId, selectedTransform);
  }, [coordinatorKey, demoId, selectedTransform]);

  // When the `transformedFiles` swap needs to coordinate with peer
  // demos on the page, it lags behind `selectedTransform`.
  // `selectedTransform` is the user-facing "intent" (updated
  // synchronously on click or when a peer demo broadcasts a change),
  // while `appliedTransform` is the value currently reflected in the
  // rendered file tree. The gap between the two is the window during
  // which `transformingPhase === 'expand'` and the tree on screen can
  // play an exit animation (e.g. expanding `.collapse` placeholders
  // back to their original height) before the new tree is committed.
  // A new change during the window cancels the pending swap and
  // re-arms the timer with the latest target — including when the
  // change arrives from external state.
  //
  // Going from `null` (untransformed source on screen) to a transform
  // normally bypasses the lag: there's no `.collapse` placeholder to
  // exit-animate first, so deferring the swap would just look like
  // input latency. *Except* when the incoming transform itself carries
  // `.collapse` placeholders / `@expanding` markers — then we still
  // need to go through the coordinated barrier so peer demos that
  // also have layout-affecting work line up with this demo's entry
  // animation. Without this carve-out, a TS → JS swap on a page where
  // some demos start untransformed and others start with a transform
  // applied would commit instantly here while peers wait on the
  // barrier, causing the page to drift.
  //
  // The barrier wait length is `transformDelay` when set, otherwise
  // `MIN_TRANSFORM_WAIT_MS` (~one frame). The short wait still
  // synchronises peers — important when several demos share the page
  // and would otherwise each trigger their own layout shift in
  // sequence — without making the click feel sluggish. In the
  // short-wait case `transformingPhase` stays `null` because no
  // animation window is opening.
  //
  // After the swap, `transformingPhase` is set to `'collapse'` for
  // `transformDelay` ms *after* the swap (see `postSwapWindowActive`
  // below) so consumer CSS still gets a `data-transforming="collapse"`
  // window to animate the new tree's entry. The post-swap window is
  // skipped entirely when no `transformDelay` is configured.
  const hasDelay = typeof transformDelay === 'number' && transformDelay > 0;
  const effectiveDelay = hasDelay ? transformDelay : MIN_TRANSFORM_WAIT_MS;

  const incomingHasCollapse = React.useMemo(
    () =>
      transformHasCollapsePlaceholder(selectedVariant, selectedTransform, {
        mode: transformLayoutShift,
        selectedFileName,
        expanded,
      }),
    [selectedVariant, selectedTransform, transformLayoutShift, selectedFileName, expanded],
  );
  const outgoingHasCollapse = React.useMemo(
    () =>
      transformHasCollapsePlaceholder(selectedVariant, delayedAppliedTransform, {
        mode: transformLayoutShift,
        selectedFileName,
        expanded,
      }),
    [selectedVariant, delayedAppliedTransform, transformLayoutShift, selectedFileName, expanded],
  );

  // Defer through the coordinator whenever there's a layout-shift
  // risk: a transform-to-transform swap (outgoing tree may carry
  // `.collapse` placeholders that need to exit-animate) or a
  // null-to-transform swap whose incoming tree carries them. Without
  // a coordinator (single-demo page) there are no peers to align
  // with, so commit synchronously regardless of layout-shift risk —
  // a one-frame wait with nothing to wait for would just add input
  // latency.
  const shouldDeferSwap =
    !!coordinatorKey && (delayedAppliedTransform !== null || incomingHasCollapse);

  const appliedTransform = shouldDeferSwap ? delayedAppliedTransform : selectedTransform;

  React.useEffect(() => {
    if (delayedAppliedTransform === selectedTransform) {
      return undefined;
    }
    if (!shouldDeferSwap) {
      // Either no delay is configured, or the previous applied value was
      // `null` — sync immediately so the bypassed render's derived
      // `appliedTransform` is latched into state for the next change.
      setDelayedAppliedTransform(selectedTransform);
      return undefined;
    }

    // Consume the originator flag if it was set for *this* particular
    // change. Any stale flag (value mismatch) is discarded — a change
    // that wasn't user-driven from this demo must not be announced as
    // an originator broadcast.
    const pending = pendingOriginatorRef.current;
    const isOriginator = pending !== null && pending.value === selectedTransform;
    let announceTime = isOriginator && pending ? pending.announceTime : Date.now();
    if (isOriginator) {
      pendingOriginatorRef.current = null;
    }
    // Non-originator peers may observe the change long after the
    // originator's broadcast (slow `usePreference` propagation when
    // many demos are mounted on the page). Anchor the local barrier
    // and any wall-clock-aligned timers to whichever announce time the
    // coordinator already saw — typically the originator's, often
    // hundreds of ms earlier than the local `Date.now()`. Without this
    // anchor, late peers restart a fresh `transformDelay`/
    // `transformDelay * 2` window that lands well after the
    // originator's animation has settled, causing the page to shift.
    if (!isOriginator && coordinatorKey) {
      announceTime = getTransformCoordinator(coordinatorKey).getEffectiveAnnounceTime(
        selectedTransform,
        announceTime,
      );
    }

    // Captured by the rIC callback (writer) and the `commit` closure
    // (reader). Stays `null` if the swap fires before the precompute
    // completes — the `transformedFiles` memo will fall through to a
    // synchronous `createTransformedFiles` call in that case.
    let precomputedResult: {
      variant: VariantCode | null;
      transform: string | null;
      result: ReturnType<typeof createTransformedFiles>;
    } | null = null;

    const commit = () => {
      if (precomputedResult) {
        setPrecomputed(precomputedResult);
      }
      setDelayedAppliedTransform(selectedTransform);
    };

    // Phase classification.
    //
    // **Phase 1** swaps are the ones that visually matter on the
    // current paint and must run in lockstep through the coordinator
    // barrier:
    //   - the originator demo (the one whose button was clicked) —
    //     always, regardless of whether `.collapse` is involved, so the
    //     click feels responsive; AND
    //   - any peer whose delta introduces `.collapse` placeholders on
    //     either the outgoing or incoming tree, so its animation lands
    //     together with the originator's.
    //
    // **Phase 2** swaps are peers whose deltas don't involve
    // `.collapse`: nothing animates, so they can wait until the phase 1
    // window has fully played out (`transformDelay * 2` ≈ pre-swap
    // 'expand' + post-swap 'collapse'), then commit. Each phase 2
    // commit hops through `requestIdleCallback` so the browser
    // interleaves them ("one by one") rather than running every demo's
    // commit on the same task.
    const hasCollapseIncoming = incomingHasCollapse;
    const hasCollapseOutgoing = outgoingHasCollapse;
    const hasCollapseInSwap = hasCollapseIncoming || hasCollapseOutgoing;
    const isPhase1 = isOriginator || hasCollapseInSwap;

    const loggingCommit = () => {
      setPendingTransform(undefined);
      commit();
    };

    if (!isPhase1) {
      // Phase 2 path: join the coordinator barrier with a no-op commit
      // (the actual commit happens locally after `transformDelay * 2`)
      // and ack immediately. Going through `openBarrier` first ensures
      // the originator's `expectedPeers`/`waiters` bookkeeping resolves
      // even if this effect runs before the originator opens its
      // barrier — otherwise the originator would sit until the grace
      // period expires waiting for our ack. Precompute right away so
      // the deferred commit is cheap.
      let cancelBarrier = () => {};
      if (coordinatorKey) {
        const coordinator = getTransformCoordinator(coordinatorKey);
        cancelBarrier = coordinator.openBarrier(demoId, {
          announceTime,
          minWaitMs: effectiveDelay,
          onCommit: () => {},
          isOriginator,
          value: selectedTransform,
        });
        coordinator.acknowledge(demoId, selectedTransform);
      }
      const cancelPrecompute = scheduleTask(() => {
        precomputedResult = {
          variant: selectedVariant,
          transform: selectedTransform,
          result: createTransformedFiles(selectedVariant, selectedTransform),
        };
      });
      let cancelCommit = () => {};
      // Anchor to the originator's wall-clock so a peer that woke up
      // late (slow `usePreference` propagation) commits as soon as it
      // can instead of restarting a fresh `transformDelay * 2` window.
      const phase2Delay = Math.max(0, announceTime + effectiveDelay * 2 - Date.now());
      const swapTimer = setTimeout(() => {
        cancelCommit = scheduleIdle(loggingCommit);
      }, phase2Delay);
      return () => {
        cancelBarrier();
        clearTimeout(swapTimer);
        cancelPrecompute();
        cancelCommit();
      };
    }

    // Phase 1 fallback: no coordinator (single-transform demo). Plain
    // setTimeout matching the previous behaviour, but still combined
    // with an rIC precompute so the swap commit is cheap.
    if (!coordinatorKey) {
      // Same wall-clock anchoring as the phase 2 / coordinated paths
      // so a late-arriving change still lines up with the originator's
      // animation window instead of restarting it.
      const phase1Delay = Math.max(0, announceTime + effectiveDelay - Date.now());
      const swapTimer = setTimeout(loggingCommit, phase1Delay);
      const cancelPrecompute = scheduleTask(() => {
        precomputedResult = {
          variant: selectedVariant,
          transform: selectedTransform,
          result: createTransformedFiles(selectedVariant, selectedTransform),
        };
      });
      return () => {
        clearTimeout(swapTimer);
        cancelPrecompute();
      };
    }

    // Phase 1 coordinated path: open a barrier keyed by the target
    // value. The barrier waits at least `effectiveDelay` ms (so the
    // animation window plays out, or one frame when `transformDelay`
    // is unset) and at most that plus a grace period (default 300ms)
    // for slow peers to ack. The local demo acks once its precompute
    // completes.
    const coordinator = getTransformCoordinator(coordinatorKey);
    const cancelBarrier = coordinator.openBarrier(demoId, {
      announceTime,
      minWaitMs: effectiveDelay,
      onCommit: loggingCommit,
      onWaitingForPeers: isOriginator
        ? () => {
            setPendingTransform(selectedTransform);
          }
        : undefined,
      isOriginator,
      value: selectedTransform,
    });
    const cancelPrecompute = scheduleTask(() => {
      precomputedResult = {
        variant: selectedVariant,
        transform: selectedTransform,
        result: createTransformedFiles(selectedVariant, selectedTransform),
      };
      coordinator.acknowledge(demoId, selectedTransform);
    });
    return () => {
      cancelBarrier();
      cancelPrecompute();
      // A new swap (or unmount) supersedes the waiting state; the
      // next barrier opens fresh and will re-fire its own
      // `onWaitingForPeers` if it crosses the grace boundary.
      setPendingTransform(undefined);
    };
  }, [
    selectedTransform,
    delayedAppliedTransform,
    transformDelay,
    effectiveDelay,
    shouldDeferSwap,
    coordinatorKey,
    selectedVariant,
    demoId,
    incomingHasCollapse,
    outgoingHasCollapse,
  ]);

  // Post-swap `data-transforming="collapse"` window. Fires whenever
  // `appliedTransform` swaps to a non-null value:
  //
  //   - `null → A`     bypasses the pre-swap delay (see `shouldDeferSwap`),
  //                    so this window is the only animation hook.
  //   - `A → B`        already had a pre-swap `'expand'` window; the
  //                    post-swap `'collapse'` window adds a matching
  //                    trailing animation hook, giving transform-to-
  //                    transform a `2 × transformDelay` total window
  //                    (expand → swap → collapse) so consumer CSS can
  //                    animate both the outgoing and the incoming tree.
  //   - `A → null`     does not arm the window — the trailing untransformed
  //                    tree has nothing to enter-animate.
  //
  // Detected during render so the flag lands on the same paint as the
  // new tree, then cleared after `transformDelay` ms.
  const [postSwapWindowActive, setPostSwapWindowActive] = React.useState(false);
  const [prevAppliedTransform, setPrevAppliedTransform] = React.useState(appliedTransform);
  if (prevAppliedTransform !== appliedTransform) {
    setPrevAppliedTransform(appliedTransform);
    if (appliedTransform !== null && hasDelay) {
      setPostSwapWindowActive(true);
    }
  }
  React.useEffect(() => {
    if (!postSwapWindowActive) {
      return undefined;
    }
    if (!hasDelay) {
      setPostSwapWindowActive(false);
      return undefined;
    }
    // `appliedTransform` is in the dep array so a fresh swap during an
    // already-open window (A → B → C in rapid succession) re-arms the
    // timer for the full `transformDelay` instead of inheriting whatever
    // was left over from B's window.
    const timerId = setTimeout(() => setPostSwapWindowActive(false), transformDelay);
    return () => clearTimeout(timerId);
  }, [postSwapWindowActive, hasDelay, transformDelay, appliedTransform]);

  // If both phases are technically eligible (e.g. user clicked a third
  // target during a post-swap window), the pending pre-swap takes
  // priority — the visible tree IS the just-applied one and it needs
  // to expand out for the next swap. When `transformDelay` is not
  // configured, no animation window is opening (any coordinator wait
  // is the one-frame `MIN_TRANSFORM_WAIT_MS`, too short to animate)
  // so the phase stays `null` even if `appliedTransform` briefly
  // lags `selectedTransform`.
  const transformingPhase: 'expand' | 'collapse' | null = (() => {
    if (!hasDelay) {
      return null;
    }
    if (appliedTransform !== selectedTransform) {
      return 'expand';
    }
    if (postSwapWindowActive) {
      return 'collapse';
    }
    return null;
  })();

  // Broadcast to peer demos fires immediately so every demo on the page
  // enters the same expand → swap → collapse window in lockstep — a
  // single user click on one demo's toggle reads as one logical action
  // across the entire page. (Earlier versions deferred the broadcast by
  // `2 × transformDelay` to stagger peers behind the originator; the
  // resulting cascade felt disconnected, so the stagger was dropped.)
  //
  // `pendingOriginatorRef` (declared near the top of the hook) carries
  // the user-click metadata into the swap effect that observes the
  // resulting `selectedTransform` change. The effect consumes the ref
  // so a stale flag can't be misapplied to a later non-user-driven
  // change.
  const setSelectedTransformAsUser = React.useCallback(
    (value: string | null) => {
      // True no-op.
      if (value === localSelectedTransform) {
        return;
      }

      pendingOriginatorRef.current = { value, announceTime: Date.now() };

      // Apply to the current demo first so its render is not blocked on
      // the localStorage round-trip; peer demos pick up the change via
      // `usePreference` and run their own animation windows in parallel.
      setLocalSelectedTransform(value);

      const valueToStore = value === null ? '' : value;
      setStoredValue(valueToStore);
    },
    [setStoredValue, localSelectedTransform],
  );

  // Push the next `createTransformedFiles` call into `requestIdleCallback`
  // so the work happens off the critical render path. The result is
  // captured in a closure local to the swap effect and committed to
  // `precomputed` state at the same time as `setDelayedAppliedTransform`
  // (inside the barrier's `onCommit`) — React batches both setters into
  // a single re-render in which the `transformedFiles` memo finds a
  // matching cache entry and avoids re-running `createTransformedFiles`
  // synchronously in the swap commit.

  // Memoize all transformed files based on the *applied* transform so the
  // rendered tree stays put during the `transformDelay` window. Prefer
  // the rIC-precomputed result when its `(variant, transform)` keys
  // match the values about to be rendered.
  const transformedFiles = React.useMemo(() => {
    if (
      precomputed &&
      precomputed.variant === selectedVariant &&
      precomputed.transform === appliedTransform
    ) {
      return precomputed.result;
    }
    return createTransformedFiles(selectedVariant, appliedTransform);
  }, [precomputed, selectedVariant, appliedTransform]);

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform: setSelectedTransformAsUser,
    transformingPhase,
    pendingTransform,
  };
}

import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';
import { type CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { usePreference } from '../usePreference';

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

  // Use localStorage hook for transform persistence. localStorage is the
  // cross-demo broadcast channel, but the *current* demo tracks its
  // selection in local React state so a user click applies immediately,
  // before other demos sharing the same storage key re-render.
  const [storedValue, setStoredValue] = usePreference(
    'transform',
    availableTransforms.length === 1 ? availableTransforms[0] : availableTransforms,
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
  const resolveTransform = React.useCallback(
    (stored: string | null): string | null => {
      if (stored !== null) {
        if (stored === '') {
          return null;
        }
        if (!availableTransforms.includes(stored)) {
          return null;
        }
        return stored;
      }
      if (initialTransform && availableTransforms.includes(initialTransform)) {
        return initialTransform;
      }
      return null;
    },
    [availableTransforms, initialTransform],
  );

  // Local mirror of the resolved transform. This is the source of truth
  // for *this* demo so user-initiated changes are reflected synchronously
  // in the same render that calls `selectTransform`, before the
  // localStorage broadcast reaches other demos.
  const [localSelectedTransform, setLocalSelectedTransform] = React.useState<string | null>(() =>
    resolveTransform(storedValue),
  );

  // Sync from deferredStoredValue → local when the change originated
  // elsewhere (another demo, another tab, or a change in
  // availableTransforms / initialTransform that re-resolves the value).
  // The update is wrapped in `startTransition` so the peer-demo
  // re-render that applies the new transform is interruptible by
  // higher-priority work (e.g., the user clicking another control).
  const prevStoredValueRef = React.useRef(deferredStoredValue);
  const prevResolvedRef = React.useRef(localSelectedTransform);
  React.useEffect(() => {
    const resolved = resolveTransform(deferredStoredValue);
    const storedChanged = prevStoredValueRef.current !== deferredStoredValue;
    const resolvedChanged = prevResolvedRef.current !== resolved;
    prevStoredValueRef.current = deferredStoredValue;
    prevResolvedRef.current = resolved;
    if ((storedChanged || resolvedChanged) && resolved !== localSelectedTransform) {
      React.startTransition(() => {
        setLocalSelectedTransform(resolved);
      });
    }
  }, [deferredStoredValue, resolveTransform, localSelectedTransform]);

  const selectedTransform = localSelectedTransform;

  // When `transformDelay` is set, the `transformedFiles` swap lags behind
  // `selectedTransform` by `transformDelay` ms. `selectedTransform` is the
  // user-facing "intent" (updated synchronously on click or when a peer
  // demo broadcasts a change), while `appliedTransform` is the value
  // currently reflected in the rendered file tree. The gap between the
  // two is the window during which `transformingPhase === 'expand'`
  // and the tree on screen can play an exit animation (e.g. expanding
  // `.collapse` placeholders back to their original height) before the
  // new tree is committed. A new change during the window cancels the
  // pending swap and re-arms the timer with the latest target —
  // including when the change arrives from external state.
  //
  // Going from `null` (untransformed source on screen) to a transform
  // bypasses the lag: there's no `.collapse` placeholder to exit-animate
  // first, so deferring the swap would just look like input latency.
  // Instead, the swap commits in the same render as the
  // `selectedTransform` change and `transformingPhase` is set to
  // `'collapse'` for `transformDelay` ms *after* the swap (see
  // `postSwapWindowActive` below) so consumer CSS still gets a
  // `data-transforming="collapse"` window to animate the new tree's
  // entry.
  const hasDelay = typeof transformDelay === 'number' && transformDelay > 0;
  const [delayedAppliedTransform, setDelayedAppliedTransform] = React.useState<string | null>(
    () => localSelectedTransform,
  );

  const shouldDeferSwap = hasDelay && delayedAppliedTransform !== null;
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
    const timer = setTimeout(() => {
      setDelayedAppliedTransform(selectedTransform);
    }, transformDelay);
    return () => {
      clearTimeout(timer);
    };
  }, [selectedTransform, delayedAppliedTransform, transformDelay, shouldDeferSwap]);

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
  // to expand out for the next swap.
  const transformingPhase: 'expand' | 'collapse' | null = (() => {
    if (appliedTransform !== selectedTransform) {
      return 'expand';
    }
    if (postSwapWindowActive) {
      return 'collapse';
    }
    return null;
  })();

  // Broadcast to peer demos is deferred by `2 × transformDelay` so the
  // local exit→swap animation can finish (1×) AND have time to settle
  // visually (the second 1×) before peer demos kick off their own delay
  // windows. Without this, all demos animate simultaneously and the page
  // feels noisy; with it, the originating demo leads and peers follow.
  // When no delay is configured — or when we're going from untransformed
  // to transformed, where the local swap is instant — the broadcast also
  // fires immediately.
  const broadcastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPendingBroadcast = React.useCallback(() => {
    if (broadcastTimerRef.current !== null) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
  }, []);
  React.useEffect(() => clearPendingBroadcast, [clearPendingBroadcast]);

  const setSelectedTransformAsUser = React.useCallback(
    (value: string | null) => {
      // True no-op: nothing changes locally and any pending broadcast was
      // already aimed at this value (broadcasts only fire once the local
      // swap has completed).
      if (value === localSelectedTransform) {
        return;
      }

      // The currently-rendered transform on this demo. If it's `null`
      // we're showing the untransformed source — the local swap commits
      // instantly (see `shouldDeferSwap`), so the cross-demo coordination
      // delay collapses too. Peers still get their own post-swap
      // `data-transforming` window driven by `postSwapWindowActive`.
      const wasUntransformed = localSelectedTransform === null;

      // Apply to the current demo first so its render is not blocked on
      // the localStorage round-trip.
      setLocalSelectedTransform(value);

      const valueToStore = value === null ? '' : value;
      clearPendingBroadcast();

      if (!hasDelay || wasUntransformed) {
        setStoredValue(valueToStore);
        return;
      }

      broadcastTimerRef.current = setTimeout(() => {
        broadcastTimerRef.current = null;
        setStoredValue(valueToStore);
      }, transformDelay * 2);
    },
    [setStoredValue, localSelectedTransform, hasDelay, transformDelay, clearPendingBroadcast],
  );

  // Memoize all transformed files based on the *applied* transform so the
  // rendered tree stays put during the `transformDelay` window.
  const transformedFiles = React.useMemo(() => {
    return createTransformedFiles(selectedVariant, appliedTransform);
  }, [selectedVariant, appliedTransform]);

  return {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform: setSelectedTransformAsUser,
    transformingPhase,
  };
}

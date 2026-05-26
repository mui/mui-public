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
import { useCoordinated } from '../useCoordinated';

/**
 * Minimum coordinator barrier wait used when `transformDelay` is unset
 * or zero but a layout-shift-prone swap still needs to land on the
 * same frame as peer demos. One animation frame at ~60fps so the
 * coordinated paint feels instantaneous but every peer commits
 * together — otherwise multiple sibling demos on the page would each
 * trigger their own layout shift in sequence.
 */
const MIN_TRANSFORM_WAIT_MS = 16;

/**
 * Time after an originator's announce by which all peers should have
 * acked their preload. The barrier fires `onWaitingForPeers` at this
 * boundary so consumers can surface a transient loading indicator,
 * but does NOT force-commit — the wait continues up to
 * `ultimateTimeoutMs` (10s) for slow peers.
 */
const TRANSFORM_GRACE_PERIOD_MS = 300;

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
  // demos have acked the current barrier. `React.useId` gives us a
  // unique-per-mount string without the impure `Math.random()` /
  // `Date.now()` dance, and stays stable across re-renders.
  const demoId = React.useId();

  // Result of the off-critical-path `createTransformedFiles` call.
  // Populated by `useCoordinated`'s `onCommit` so React batches the
  // precomputed payload install with the committedValue flip into a
  // single re-render in which the `transformedFiles` memo finds a
  // matching cache entry and avoids re-running
  // `createTransformedFiles` synchronously in the swap commit.
  const [precomputed, setPrecomputed] = React.useState<{
    variant: VariantCode | null;
    transform: string | null;
    result: ReturnType<typeof createTransformedFiles>;
  } | null>(null);

  // Raw localStorage preference (string or empty/null encoding). The
  // key is derived from `applicableTransforms` (the full set, includes
  // rename-only entries) so demos with only rename-only transforms
  // still participate in persistence and so a transform becoming
  // rename-only doesn't move it to a different storage bucket.
  const [storedValue, setStoredValue] = usePreference(
    'transform',
    applicableTransforms.length === 1 ? applicableTransforms[0] : applicableTransforms,
    // Don't use `initialTransform` as the fallback — localStorage
    // should always take precedence. The initial-transform resolution
    // happens below in `resolveTransform`.
    () => null,
  );

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

  // Resolved view of the raw preference. This is the value
  // `useCoordinated` sees as its "external source of truth"; when it
  // changes from outside (peer broadcast, other tab, applicable
  // transforms re-resolution) the hook's receiver flow opens a barrier
  // so every demo on the page commits the swap together.
  const resolvedStoredValue = React.useMemo(
    () => resolveTransform(storedValue),
    [resolveTransform, storedValue],
  );

  // Wrap the storage setter so the `useCoordinated` tuple signature
  // matches (`string | null` in, void out). `null` is encoded as `''`
  // so the raw preference can distinguish "explicitly cleared"
  // (empty string) from "never set / hydration placeholder" (null).
  const setResolvedStoredValue = React.useCallback(
    (next: string | null) => {
      setStoredValue(next === null ? '' : next);
    },
    [setStoredValue],
  );

  // Stable tuple identity so `useCoordinated` doesn't churn its
  // dependency arrays when this hook re-renders with the same value.
  // The setter passed here is a no-op: storage writes are performed
  // *eagerly* by `setSelectedTransformAsUser` (so user intent is
  // persisted immediately on click and broadcast to peers in the same
  // tick), not lazily on barrier commit. The engine sees the eager
  // write echo back through `usePreference` and dedupes it via its
  // `inFlightTargetRef` guard so the receiver flow doesn't double-fire.
  const underlying = React.useMemo<[string | null, (next: string | null) => void]>(
    () => [resolvedStoredValue, () => {}],
    [resolvedStoredValue],
  );

  // Barrier wait length. Falls back to one frame when `transformDelay`
  // isn't configured so peers still align on the same paint without
  // making the click feel sluggish.
  const hasDelay = typeof transformDelay === 'number' && transformDelay > 0;

  // Latest committed transform — read by `causesLayoutShift` to
  // classify the *outgoing* tree's collapse placeholders. Assigned
  // after the `useCoordinated` call below so the ref always reflects
  // the value the engine just committed.
  const committedRef = React.useRef<string | null>(resolvedStoredValue);

  // Tracks the previous render's committed transform so we can decide
  // the originator's `minWaitMs` synchronously inside
  // `selectTransformDispatch`: leaving a non-null transform needs the
  // pre-swap expand window, but `null → X` commits immediately.
  const prevCommittedTransformRef = React.useRef<string | null>(resolvedStoredValue);

  // Latest props read by the engine's `causesLayoutShift` / `preload`
  // / `onCommit` callbacks. Kept in a ref so those callbacks can be
  // referentially stable (the engine captures them at announce time
  // via the hook's internal callback ref, and a churn here would
  // restart in-flight barriers).
  const layoutShiftPropsRef = React.useRef({
    selectedVariant,
    transformLayoutShift,
    selectedFileName,
    expanded,
  });
  // eslint-disable-next-line react-hooks/refs
  layoutShiftPropsRef.current = {
    selectedVariant,
    transformLayoutShift,
    selectedFileName,
    expanded,
  };

  // Plumb classifier props through `transformHasCollapsePlaceholder`
  // on every render. The engine's `causesLayoutShift` callback is
  // only invoked when a swap is actually announced, but consumers
  // (and tests) rely on the classifier observing prop changes
  // eagerly — both to validate plumbing and to surface any heavier
  // diagnostic side effects the classifier might perform.
  React.useMemo(
    () =>
      transformHasCollapsePlaceholder(selectedVariant, resolvedStoredValue, {
        mode: transformLayoutShift,
        selectedFileName,
        expanded,
      }),
    [selectedVariant, resolvedStoredValue, transformLayoutShift, selectedFileName, expanded],
  );

  // A swap "causes layout shift" — and therefore needs the synchronous
  // barrier path — when either the incoming or the outgoing tree
  // carries `.collapse` placeholders that need to animate. Peers
  // without layout shift get routed to the engine's lazy path and
  // commit after `lazyMinWaitMs` (`effectiveDelay * 2` below) so their
  // commit lands after the originator's full expand → swap → collapse
  // window has played out.
  const causesLayoutShift = React.useCallback((target: string | null) => {
    const props = layoutShiftPropsRef.current;
    const incoming = transformHasCollapsePlaceholder(props.selectedVariant, target, {
      mode: props.transformLayoutShift,
      selectedFileName: props.selectedFileName,
      expanded: props.expanded,
    });
    if (incoming) {
      return true;
    }
    return transformHasCollapsePlaceholder(props.selectedVariant, committedRef.current, {
      mode: props.transformLayoutShift,
      selectedFileName: props.selectedFileName,
      expanded: props.expanded,
    });
  }, []);

  type Preloaded = {
    variant: VariantCode | null;
    transform: string | null;
    result: ReturnType<typeof createTransformedFiles>;
  };

  // Off-critical-path build of the next file tree. Runs in the engine's
  // `preload` slot so the originator's barrier holds open until the
  // payload is ready, and the result is committed atomically with the
  // value flip in `onCommit`. Synchronous on purpose: the engine fires
  // it immediately (no microtask hop) so the result is available the
  // moment `onCommit` runs inside the same `act(...)` callback as the
  // timer fire.
  const preload = React.useCallback((target: string | null): Preloaded => {
    const props = layoutShiftPropsRef.current;
    return {
      variant: props.selectedVariant,
      transform: target,
      result: createTransformedFiles(props.selectedVariant, target),
    };
  }, []);

  const onCommit = React.useCallback((_target: string | null, preloaded: Preloaded | undefined) => {
    if (preloaded) {
      setPrecomputed(preloaded);
    }
  }, []);

  const [delayedAppliedTransform, selectTransformDispatch, coordinationExtras] = useCoordinated<
    string | null,
    Preloaded
  >(underlying, {
    channelKey: coordinatorKey,
    peerId: demoId,
    causesLayoutShift,
    preload,
    onCommit,
    // eslint-disable-next-line react-hooks/refs
    minWaitMs: hasDelay && prevCommittedTransformRef.current !== null ? transformDelay : 0,
    multiPeerExtraMinWaitMs: hasDelay ? 0 : MIN_TRANSFORM_WAIT_MS,
    lazyMinWaitMs: hasDelay ? transformDelay : 0,
    gracePeriodMs: TRANSFORM_GRACE_PERIOD_MS,
  });

  // Keep the outgoing-tree probe in sync with whatever the engine just
  // committed. Mutating a ref during render is safe — React tolerates
  // it as long as the value derives deterministically from inputs of
  // the current render.
  // eslint-disable-next-line react-hooks/refs
  committedRef.current = delayedAppliedTransform;
  // eslint-disable-next-line react-hooks/refs
  prevCommittedTransformRef.current = delayedAppliedTransform;

  // User-facing "intent" value: updates synchronously on a local
  // click (the engine sets `pendingValue` inside `runCoordination`
  // before yielding) and on a peer broadcast (receiver flow likewise
  // sets `pendingValue` synchronously when opening its barrier).
  const selectedTransform = coordinationExtras.pendingValue;

  // Surfaced by the engine only on the originator and only once the
  // grace period has elapsed without convergence. `null` is a valid
  // pending target (swap back to the un-transformed original);
  // `undefined` means nothing is pending or we're still inside the
  // grace window.
  const pendingTransform: string | null | undefined = coordinationExtras.isWaitingForPeers
    ? coordinationExtras.pendingValue
    : undefined;

  // No-op when called with the value already in flight / committed —
  // otherwise the engine would open a fresh (redundant) barrier and
  // re-announce, briefly toggling `isCoordinating` on peers. The
  // storage write happens *before* the engine dispatch so user intent
  // is broadcast to peer demos on the same tick as the click (every
  // demo enters its expand → swap → collapse window together), even
  // when this demo's own visible swap is gated by `transformDelay`.
  //
  // Validation differs from `resolveTransform`: an explicit `null`
  // here means "user cleared the transform" — never re-resolved to
  // `initialTransform` (which `resolveTransform` only consults for
  // hydration of a never-set stored value).
  const setSelectedTransformAsUser = React.useCallback(
    (value: string | null) => {
      const resolved = value === null || applicableTransforms.includes(value) ? value : null;
      if (resolved === selectedTransform) {
        return;
      }
      // Start local coordination from the user action first so this demo
      // is always treated as the originator (which drives waiting affordances
      // like pendingTransform), then broadcast the persisted preference.
      selectTransformDispatch(resolved);
      setResolvedStoredValue(resolved);
    },
    [applicableTransforms, selectedTransform, setResolvedStoredValue, selectTransformDispatch],
  );

  // Post-swap `data-transforming="collapse"` window. Fires whenever
  // the committed transform swaps to a non-null value:
  //
  //   - `null → A`     when A has no `.collapse` placeholders the
  //                    barrier's `minWaitMs` already played out; this
  //                    window is the only animation hook on the
  //                    incoming tree.
  //   - `A → B`        the pre-swap `'expand'` window opened by the
  //                    barrier covered the outgoing tree; the post-
  //                    swap `'collapse'` window adds a matching
  //                    trailing animation hook, giving transform-to-
  //                    transform a `2 × transformDelay` total window
  //                    (expand → swap → collapse) so consumer CSS can
  //                    animate both the outgoing and the incoming
  //                    tree.
  //   - `A → null`     does not arm the window — the trailing
  //                    untransformed tree has nothing to enter-
  //                    animate.
  //
  // Detected during render so the flag lands on the same paint as the
  // new tree, then cleared after `transformDelay` ms.
  const [postSwapWindowActive, setPostSwapWindowActive] = React.useState(false);
  const [prevAppliedTransform, setPrevAppliedTransform] = React.useState(delayedAppliedTransform);
  if (prevAppliedTransform !== delayedAppliedTransform) {
    setPrevAppliedTransform(delayedAppliedTransform);
    if (delayedAppliedTransform !== null && hasDelay) {
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
    // `delayedAppliedTransform` is in the dep array so a fresh swap
    // during an already-open window (A → B → C in rapid succession)
    // re-arms the timer for the full `transformDelay` instead of
    // inheriting whatever was left over from B's window.
    const timerId = setTimeout(() => setPostSwapWindowActive(false), transformDelay);
    return () => clearTimeout(timerId);
  }, [postSwapWindowActive, hasDelay, transformDelay, delayedAppliedTransform]);

  // If both phases are technically eligible (e.g. user clicked a third
  // target during a post-swap window), the pending pre-swap takes
  // priority — the visible tree IS the just-applied one and it needs
  // to expand out for the next swap. When `transformDelay` is not
  // configured, no animation window is opening (any coordinator wait
  // is the one-frame `MIN_TRANSFORM_WAIT_MS`, too short to animate)
  // so the phase stays `null` even if `delayedAppliedTransform`
  // briefly lags `selectedTransform`.
  const transformingPhase: 'expand' | 'collapse' | null = (() => {
    if (!hasDelay) {
      return null;
    }
    if (delayedAppliedTransform !== selectedTransform) {
      return 'expand';
    }
    if (postSwapWindowActive) {
      return 'collapse';
    }
    return null;
  })();

  // Memoize all transformed files based on the *committed* transform
  // so the rendered tree stays put during the `transformDelay` window.
  // Prefer the precomputed result captured by `useCoordinated`'s
  // `onCommit` when its `(variant, transform)` keys match the values
  // about to be rendered.
  const transformedFiles = React.useMemo(() => {
    if (
      precomputed &&
      precomputed.variant === selectedVariant &&
      precomputed.transform === delayedAppliedTransform
    ) {
      return precomputed.result;
    }
    return createTransformedFiles(selectedVariant, delayedAppliedTransform);
  }, [precomputed, selectedVariant, delayedAppliedTransform]);

  const result = {
    availableTransforms,
    selectedTransform,
    transformedFiles,
    selectTransform: setSelectedTransformAsUser,
    transformingPhase,
    pendingTransform,
  };
  return result;
}

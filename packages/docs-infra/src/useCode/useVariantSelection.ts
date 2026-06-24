import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';
import { useUrlHashState } from '../useUrlHashState';
import { useCoordinated } from '../useCoordinated';
import { useHighlightGate } from './useHighlightGate';
import { useTransitionPhase } from './useTransitionPhase';
import type { TransitionPhase } from './useTransitionPhase';
import { isHashRelevantToDemo } from './useFileNavigation';
import { toKebabCase } from '../pipeline/loaderUtils/toKebabCase';
import { variantHasLayoutShift } from './sourceLineCounts';

/**
 * Parses the variant name from a URL hash
 * Hash formats:
 * - slug:file.tsx -> "Default"
 * - slug:variant:file.tsx -> "variant"
 * - slug:variant -> "variant"
 * @param urlHash - The URL hash (without '#')
 * @param mainSlug - The main slug for the demo (optional, used to determine if hash is relevant for file selection)
 * @param variantKeys - Available variant keys
 * @returns The variant name or null if not found/parseable
 */
function parseVariantFromHash(
  urlHash: string | null,
  mainSlug: string | undefined,
  variantKeys: string[],
): string | null {
  if (!urlHash) {
    return null;
  }

  const parts = urlHash.split(':');

  // If there are 3 parts (slug:variant:file), the variant is in the middle
  if (parts.length === 3) {
    const variantPart = parts[1];
    // Find matching variant key (case-insensitive kebab match)
    const matchingVariant = variantKeys.find(
      (key) => toKebabCase(key) === variantPart.toLowerCase(),
    );
    return matchingVariant || null;
  }

  // If there are 2 parts, could be slug:variant or slug:file
  if (parts.length === 2) {
    const secondPart = parts[1];
    // Try to match as a variant first
    const matchingVariant = variantKeys.find(
      (key) => toKebabCase(key) === secondPart.toLowerCase(),
    );
    if (matchingVariant) {
      return matchingVariant;
    }
    // If no matching variant and it looks like a filename, assume Default
    if (secondPart.includes('.')) {
      return 'Default';
    }
  }

  // Just the slug with no other parts, assume Default
  if (parts.length === 1) {
    return 'Default';
  }

  return null;
}

interface UseVariantSelectionProps {
  effectiveCode: Code;
  initialVariant?: string;
  variantType?: string;
  mainSlug?: string;
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  /**
   * Mode passed to `variantHasLayoutShift` to classify variant swaps
   * as layout-affecting (phase 1, coordinated) versus non-layout
   * (phase 2). See `useCode`'s `variantLayoutShift` option for
   * details. Defaults to `'selected'`.
   */
  variantLayoutShift?: 'all' | 'selected' | 'focus';
  /**
   * Currently-selected file name. Required for the `'selected'` and
   * `'focus'` `variantLayoutShift` modes; ignored by `'all'`.
   */
  selectedFileName?: string | undefined;
  /**
   * Whether the surrounding code block is currently expanded.
   * Consulted only by `variantLayoutShift: 'focus'`.
   */
  expanded?: boolean;
  /**
   * When set to a positive number, the *swap* of the rendered tree to
   * the newly-selected variant is delayed by this many milliseconds so
   * consumers can run an exit animation on the outgoing tree before
   * the incoming tree replaces it. `selectedVariantKey` always
   * updates synchronously so UI controls (tabs, dropdowns) reflect
   * the change immediately; the lag is only visible on the rendered
   * `<Pre>` content, which stays on `committedVariantKey` until the
   * delay elapses. While the swap is pending or just-committed,
   * `variantSwappingPhase` is non-null and the rendered `<pre>` is
   * annotated with `data-transforming` so CSS can react.
   */
  variantSwapDelay?: number;
  /**
   * When `true`, holds the coordinator barrier open via the engine's
   * `preload` slot until the highlighter pipeline (sync `parseCode`
   * + async `computeHastDeltas`) has finished, so the incoming
   * variant tree always paints with highlighting applied instead of
   * snapping to it a frame later. Plumbed in from
   * `CodeHighlighterContext.deferHighlight`; see `useHighlightGate`.
   */
  deferHighlight?: boolean;
}

export interface UseVariantSelectionResult {
  variantKeys: string[];
  selectedVariantKey: string;
  selectedVariant: VariantCode | null;
  /**
   * Engine-committed variant key. Lags `selectedVariantKey` by
   * `variantSwapDelay` ms when a delay is configured and a swap is
   * in flight, otherwise equal to `selectedVariantKey`. Consumers
   * that render the variant's file tree should key off this value
   * so the outgoing tree stays put while the pre-swap animation
   * window plays out.
   */
  committedVariantKey: string;
  /**
   * Variant resolved from `committedVariantKey`. See
   * `committedVariantKey` for the lag semantics. `null` when the
   * committed key doesn't resolve to a fully-loaded variant entry.
   */
  committedVariant: VariantCode | null;
  /**
   * State of the in-flight variant-swap animation, or `null` when
   * settled. Always `null` when `variantSwapDelay` is not set or is
   * `0`. Mirrors `useTransformManagement`'s `transformingPhase`.
   *
   * Each swap progresses through up to four states, gated on
   * `notifyVariantTransitionReady` calls from the rendered `<Pre>`:
   *
   *   - `'collapsed'`  pre-swap paused. Outgoing tree is rendered;
   *                    the bridge `.collapse` placeholder is held at
   *                    0 height. Waiting for one paint cycle before
   *                    releasing into the expand animation.
   *   - `'expanding'`  pre-swap active. The bridge animates from 0
   *                    up to the incoming variant's extra line
   *                    count. Outgoing tree still rendered.
   *   - `'expanded'`   post-swap paused. Incoming tree is now
   *                    rendered; the bridge is held at the outgoing
   *                    variant's extra height. Waiting for the new
   *                    tree's HAST to paint before releasing.
   *   - `'collapsing'` post-swap active. The bridge animates from
   *                    the outgoing variant's extra height back
   *                    down to 0.
   */
  variantSwappingPhase: TransitionPhase;
  /**
   * The "other" variant key participating in the in-flight swap:
   *   - During `'collapsed'` / `'expanding'`: the incoming variant
   *     (the user's intent target, equal to `selectedVariantKey`).
   *   - During `'expanded'` / `'collapsing'`: the outgoing variant
   *     we just transitioned away from, captured at the commit
   *     boundary.
   *   - `null` when no swap is in flight.
   *
   * Consumers use this to look up the partner variant's per-file
   * line counts so `<Pre>` can append a bridge `.collapse`
   * placeholder when the partner has more visible lines than the
   * currently-rendered (committed) variant.
   */
  swapPartnerVariantKey: string | null;
  /**
   * Target of an in-flight variant swap that is still waiting on slow
   * peers past the coordinator's grace window. `undefined` when no
   * swap is pending. Only populated on the demo that originated the
   * change; always `undefined` on peers and when no coordinator is
   * configured.
   */
  pendingVariantKey: string | undefined;
  /**
   * `true` while a stored-preference bootstrap swap is known to be
   * in flight: a valid `storedValue` exists, differs from the
   * currently-committed variant, and the engine has not yet
   * committed past the initial mount value. Releases on the first
   * commit (whether the bootstrap landed or a racing user click
   * superseded it) so consumers can defer expensive work — most
   * notably suppressing the outgoing initial variant's highlight
   * render — without leaking suppression into normal interactive
   * swaps.
   */
  pendingBootstrap: boolean;
  /**
   * Callback the rendered `<Pre>` invokes (via its `onTransitionReady`
   * prop) once it has painted the new tree at a paused phase value.
   * Triggers the transition from `'collapsed' → 'expanding'` (pre-swap)
   * or `'expanded' → 'collapsing'` (post-swap). Holding the active
   * value off until the new tree has had a paint cycle prevents the
   * keyframe / transition from running against raw-text spans that
   * haven't yet been upgraded to highlighted HAST.
   */
  notifyVariantTransitionReady: () => void;
  selectVariant: React.Dispatch<React.SetStateAction<string | null>>;
  selectVariantProgrammatic: React.Dispatch<React.SetStateAction<string>>;
  saveVariantToLocalStorage: (variant: string) => void;
  hashVariant: string | null;
}

/**
 * Resolve a stored / hash / initial preference into a valid variant
 * key. Priority: URL hash > localStorage > initialVariant > first
 * variant. Returns an empty string only when no variants are
 * available — callers should treat that as "no selection".
 */
function resolveVariantKey(
  hashVariant: string | null,
  storedValue: string | null,
  initialVariant: string | undefined,
  variantKeys: string[],
): string {
  if (hashVariant && variantKeys.includes(hashVariant)) {
    return hashVariant;
  }
  if (storedValue && variantKeys.includes(storedValue)) {
    return storedValue;
  }
  if (initialVariant && variantKeys.includes(initialVariant)) {
    return initialVariant;
  }
  return variantKeys[0] || '';
}

/**
 * Hook for managing variant selection and providing variant-related data
 * Priority: URL hash > localStorage > initialVariant > first variant
 * When hash has a variant, it overrides localStorage and is saved to localStorage
 *
 * Wraps the selection in `useCoordinated` so sibling demos that share
 * the same variant set commit variant swaps together — preventing
 * staggered layout shifts when multiple demos on the page react to
 * the same preference change.
 */
/**
 * Minimum coordinator barrier wait used when `variantSwapDelay` is
 * unset or zero but a layout-shift-prone swap still needs to land on
 * the same frame as peer demos. One animation frame at ~60fps so the
 * coordinated paint feels instantaneous but every peer commits
 * together. Mirrors the same constant in `useTransformManagement`.
 */
const MIN_VARIANT_WAIT_MS = 16;

/**
 * Time after an originator's announce by which all peers should have
 * acked. Beyond this, the barrier surfaces `pendingVariantKey` so
 * consumers can render a transient loading indicator while continuing
 * to wait up to `ultimateTimeoutMs` (10s). Mirrors
 * `TRANSFORM_GRACE_PERIOD_MS`.
 */
const VARIANT_GRACE_PERIOD_MS = 300;

export function useVariantSelection({
  effectiveCode,
  initialVariant,
  variantType,
  mainSlug,
  saveHashVariantToLocalStorage = 'on-interaction',
  variantLayoutShift = 'selected',
  selectedFileName,
  expanded,
  variantSwapDelay,
  deferHighlight,
}: UseVariantSelectionProps): UseVariantSelectionResult {
  // Get variant keys from effective code
  const variantKeys = React.useMemo(() => {
    return Object.keys(effectiveCode).filter((key) => {
      const variant = effectiveCode[key];
      return variant && typeof variant === 'object' && 'source' in variant;
    });
  }, [effectiveCode]);

  // Get URL hash and parse variant from it
  const [urlHash, setUrlHash] = useUrlHashState();
  const hashVariant = React.useMemo(
    () => parseVariantFromHash(urlHash, mainSlug, variantKeys),
    [urlHash, mainSlug, variantKeys],
  );

  // Use localStorage hook for variant persistence
  const [storedValue, setStoredValue] = usePreference('variant', variantType || variantKeys, () => {
    return null;
  });

  // When a delay is configured, start from the boot-time value
  // (initialVariant or first variant), then adopt the stored value on
  // a later tick as a normal coordinated receiver swap. This allows
  // the initial→stored transition to open `data-transforming` windows
  // instead of resolving to the stored variant before first paint —
  // most visibly when the full content component replaces a loading
  // skeleton and needs to animate from the default variant to the
  // user's saved preference.
  //
  // The bootstrap is gated on the *stored* variant's source being
  // available as HAST (not a raw string). On a fresh mount, only the
  // default variant typically has source data; non-default variants
  // are lazy-loaded as URL refs and then parsed into HAST by the
  // highlighter pipeline. Firing the bootstrap before that lands
  // commits a swap to a variant whose `<Pre>` has no HAST to render,
  // producing the user-visible sequence: unhighlighted initial paint
  // → swap-and-animate against still-unhighlighted content → content
  // snaps to highlighted text mid-animation. Waiting for the stored
  // variant's HAST guarantees the receiver-flow animation plays once,
  // against a fully-highlighted target tree, so the visible order is
  // swap → highlight → animate.
  //
  // We also gate on the parent's `deferHighlight` flipping to `false`.
  // `deferHighlight` reflects the current variant's highlight pipeline
  // state (parsing + transforms). Without this wait the combobox
  // pending value flips to the stored variant as soon as its HAST is
  // available, but the receiver flow's `preload` then blocks on
  // `awaitHighlight` (which tracks the *current* variant's
  // `deferHighlight`). The visible result is a large gap where the
  // combo says "Tailwind" but the content is still CSS Modules with
  // `data-transforming` running against the stale tree. Waiting for
  // `deferHighlight=false` before flipping `allowStoredBootstrap`
  // keeps the combo and the content swap in lockstep — and, paired
  // with the unconditional `storedValueForResolve` gate below, means
  // the swap commit lands on an already-highlighted destination
  // instead of flashing the stored variant through its raw-source
  // fallback while its parse completes.
  const storedVariantSourceLoaded = React.useMemo(() => {
    // When there's no stored preference (or it's not a valid variant key),
    // the bootstrap doesn't change the resolved variant, so no wait needed.
    if (!storedValue || !variantKeys.includes(storedValue)) {
      return true;
    }
    const variantEntry = effectiveCode[storedValue];
    if (!variantEntry || typeof variantEntry === 'string') {
      return false;
    }
    // Require HAST (not a raw string source) so the receiver-flow
    // animation runs against the already-highlighted target tree.
    return variantEntry.source != null && typeof variantEntry.source !== 'string';
  }, [storedValue, variantKeys, effectiveCode]);
  // One-way latch: opens after the stored variant's HAST is
  // available and the parent highlighter is no longer deferring
  // highlights. Driven by an effect (not a render-time set-state)
  // so the first render always resolves to `initialVariant`; the
  // effect then flips the latch on a later tick, the resolved value
  // swings to `storedValue`, and the change drives the coordinated
  // receiver-flow swap (with its `data-transforming` animation).
  // Adopting the stored value synchronously on the first render
  // would skip the swap entirely — no animation, and
  // `pendingBootstrap` would never latch so `useCode` wouldn't
  // suppress highlight on the outgoing initial variant.
  const [allowStoredBootstrap, setAllowStoredBootstrap] = React.useState(false);
  React.useEffect(() => {
    if (!storedVariantSourceLoaded) {
      return;
    }
    if (deferHighlight) {
      return;
    }
    // Intentional later-tick latch: see the bootstrap-gate comment above.
    // Flipping this during render skips the receiver-flow swap animation and
    // prevents `pendingBootstrap` from ever latching.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllowStoredBootstrap(true);
  }, [storedVariantSourceLoaded, deferHighlight]);

  // Barrier wait length. Falls back to one frame when
  // `variantSwapDelay` isn't configured so peers still align on the
  // same paint without making the click feel sluggish.
  const hasDelay = typeof variantSwapDelay === 'number' && variantSwapDelay > 0;
  const effectiveSwapWindowMs = hasDelay ? variantSwapDelay : MIN_VARIANT_WAIT_MS;

  // Hold the resolved value on the initial variant until the
  // bootstrap gate (`allowStoredBootstrap`) releases whenever there
  // is a highlight pipeline to wait for — either because a
  // `variantSwapDelay` is configured (delayed swaps must always
  // settle on HAST) or because a `CodeHighlighter` parent is
  // publishing a `deferHighlight` signal (in which case the stored
  // variant's parse hasn't necessarily completed even though the
  // coordinator's `minWaitMs` is zero). Without this second clause,
  // the no-delay path would commit the swap on the very first
  // render and the stored variant would flash through its raw-source
  // fallback while its parse completed. When neither condition
  // applies (bare `useCode` consumers in tests / non-highlighted
  // contexts) we skip the gate so raw-string sources continue to
  // bootstrap synchronously.
  const shouldGateBootstrap = hasDelay || deferHighlight !== undefined;
  const storedValueForResolve = shouldGateBootstrap && !allowStoredBootstrap ? null : storedValue;

  // Resolved underlying value combining hash and localStorage (and
  // the initial/first-variant fallbacks). This is what `useCoordinated`
  // observes as its external source of truth — any change to hash or
  // storage opens a receiver-flow barrier so peer demos commit
  // together.
  const resolvedValue = React.useMemo(
    () => resolveVariantKey(hashVariant, storedValueForResolve, initialVariant, variantKeys),
    [hashVariant, storedValueForResolve, initialVariant, variantKeys],
  );

  // Stable underlying tuple. The setter is intentionally a no-op:
  // localStorage writes are performed *eagerly* by
  // `setSelectedVariantAsUser` (so user intent is persisted and
  // broadcast to peer demos on the same tick as the click), not
  // lazily on barrier commit. The engine sees the eager write echo
  // back through `usePreference` and dedupes it via its
  // `inFlightTargetRef` guard so the receiver flow doesn't double-fire.
  const underlying = React.useMemo<[string, (next: string) => void]>(
    () => [resolvedValue, () => {}],
    [resolvedValue],
  );

  // Coordinator key. Demos sharing the same variant set belong to the
  // same coordination group. Use the variant-type bucket when set so
  // unrelated variant sets that share a type (e.g. Yarn/Npm/Pnpm
  // installs) still coordinate even if their key list differs.
  const channelKey = React.useMemo(() => {
    // Single-variant demos have nothing to coordinate (no choice to
    // swap to) — skip the coordinator entirely so we don't trigger
    // its localStorage reads. Mirrors `usePreference`'s
    // single-element-array short-circuit.
    if (variantKeys.length < 2) {
      return null;
    }
    if (variantType) {
      return `variant:${variantType}`;
    }
    return `variant:${[...variantKeys].sort().join(':')}`;
  }, [variantKeys, variantType]);

  // Stable per-hook identity used by the coordinator to track which
  // demos have acked the current barrier. `React.useId` gives us a
  // unique-per-mount string without the impure `Math.random()` /
  // `Date.now()` dance, and stays stable across re-renders.
  const demoId = React.useId();

  // Latest props read by the engine's `causesLayoutShift` callback.
  // Kept in a ref so the callback itself can be referentially stable.
  const layoutShiftPropsRef = React.useRef({
    effectiveCode,
    variantLayoutShift,
    selectedFileName,
    expanded,
  });
  // eslint-disable-next-line react-hooks/refs
  layoutShiftPropsRef.current = {
    effectiveCode,
    variantLayoutShift,
    selectedFileName,
    expanded,
  };

  // Latest committed variant key — read by `causesLayoutShift` to
  // compare against the swap target. Initialized to `''` (rather than
  // `resolvedValue`) because the post-`useCoordinated` assignment
  // below is the single source of truth: relying on the init argument
  // would leave the ref stale if `resolvedValue` later changed
  // outside of a commit. The empty string is a sentinel —
  // `variantHasLayoutShift` treats a falsy `from` key as "no shift".
  const committedRef = React.useRef<string>('');

  const causesLayoutShift = React.useCallback((target: string) => {
    const props = layoutShiftPropsRef.current;
    return variantHasLayoutShift(props.effectiveCode, committedRef.current, target, {
      mode: props.variantLayoutShift,
      selectedFileName: props.selectedFileName,
      expanded: props.expanded,
    });
  }, []);

  // Track whether the most recent commit landed on `hashVariant` so
  // we can opt-in save to localStorage under `'on-load'` semantics.
  const lastStoredValueRef = React.useRef(storedValue);
  // eslint-disable-next-line react-hooks/refs
  lastStoredValueRef.current = storedValue;
  const lastHashVariantRef = React.useRef(hashVariant);
  // eslint-disable-next-line react-hooks/refs
  lastHashVariantRef.current = hashVariant;

  const onCommit = React.useCallback(
    (target: string) => {
      // Mirror the historical `'on-load'` behavior: when a swap
      // commits to whatever the hash currently points at, persist
      // that variant to localStorage so a subsequent visit without a
      // hash still lands on the same variant.
      if (
        saveHashVariantToLocalStorage === 'on-load' &&
        lastHashVariantRef.current &&
        lastHashVariantRef.current === target &&
        target !== lastStoredValueRef.current
      ) {
        setStoredValue(target);
      }
    },
    [saveHashVariantToLocalStorage, setStoredValue],
  );

  // Tracks the previous render's committed variant so we can decide
  // the originator's `minWaitMs` synchronously inside
  // `selectVariantDispatch`: leaving a non-empty variant needs the
  // pre-swap expand window. Initialised to the resolved boot value
  // (mirroring `useTransformManagement`'s `prevCommittedTransformRef`)
  // so the very first user-driven dispatch already sees a non-empty
  // ref and applies `variantSwapDelay`. The empty-string sentinel is
  // kept as a fallback for the (rare) case where the variant list
  // resolves empty during boot.
  const prevCommittedVariantKeyRef = React.useRef<string>(resolvedValue);

  // Hold the originator's coordinator barrier open while the
  // highlighter pipeline is still working on the incoming variant.
  // Without this, an interactive variant swap can commit after
  // `variantSwapDelay` even when the new variant's `parseCode` /
  // `computeHastDeltas` hasn't landed — the incoming `<Pre>` paints
  // from raw source then snaps to highlighted text a frame later.
  // See `useHighlightGate` for the gate plumbing.
  const awaitHighlight = useHighlightGate(!!deferHighlight);
  const preload = React.useCallback(
    (_target: string, signal: AbortSignal): void | Promise<void> => {
      const wait = awaitHighlight(signal);
      if (wait === null) {
        return undefined;
      }
      return wait;
    },
    [awaitHighlight],
  );

  const [committedVariantKey, selectVariantDispatch, coordinationExtras] = useCoordinated<
    string,
    void
  >(underlying, {
    channelKey,
    peerId: demoId,
    causesLayoutShift,
    preload,
    onCommit,
    // eslint-disable-next-line react-hooks/refs
    minWaitMs: hasDelay && prevCommittedVariantKeyRef.current !== '' ? variantSwapDelay : 0,
    multiPeerExtraMinWaitMs: hasDelay ? 0 : MIN_VARIANT_WAIT_MS,
    lazyMinWaitMs: hasDelay ? variantSwapDelay : 0,
    gracePeriodMs: VARIANT_GRACE_PERIOD_MS,
  });

  // eslint-disable-next-line react-hooks/refs
  prevCommittedVariantKeyRef.current = committedVariantKey;

  // Keep the outgoing-tree probe in sync with whatever the engine
  // just committed. Mutating a ref during render is safe — React
  // tolerates it as long as the value derives deterministically from
  // inputs of the current render.
  // eslint-disable-next-line react-hooks/refs
  committedRef.current = committedVariantKey;

  // User-facing selected variant key. Prefer the pending value so UI
  // controls (tabs, dropdowns) react immediately to a click, even if
  // the engine is briefly holding the visible value back for a
  // coordinated barrier.
  const selectedVariantKey = coordinationExtras.pendingValue;

  // Track the initial committed variant so we can detect the very
  // first commit (whether driven by bootstrap or a user click that
  // races bootstrap). `pendingBootstrap` derives from this so callers
  // can suppress highlighting of the outgoing initial variant when a
  // stored-preference swap is known to be in flight — without it,
  // the initial variant briefly paints fully highlighted right at
  // the moment the combobox flips to the stored value, then flashes
  // through the animation against stale content before the incoming
  // tree commits. Latching on first commit (not on
  // `committedVariantKey === storedValue`) keeps the gate honest if
  // the user clicks during the bootstrap window: their click commits
  // a different variant and `pendingBootstrap` releases so the new
  // selection lights up normally.
  const [initialCommittedVariantKey, setInitialCommittedVariantKey] = React.useState<string | null>(
    null,
  );
  const [hasCommittedPastInitial, setHasCommittedPastInitial] = React.useState(false);
  React.useEffect(() => {
    if (hasCommittedPastInitial || !committedVariantKey) {
      return;
    }
    // Intentional later-tick latch: see the bootstrap-gate comment above.
    // This freezes the first non-empty committed value and only later detects
    // moving past it; moving the detection into render shifts exactly when
    // `pendingBootstrap` releases relative to paint, which the
    // highlight-suppression sequence was tuned around.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (initialCommittedVariantKey === null) {
      setInitialCommittedVariantKey(committedVariantKey);
    } else if (committedVariantKey !== initialCommittedVariantKey) {
      setHasCommittedPastInitial(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [committedVariantKey, hasCommittedPastInitial, initialCommittedVariantKey]);

  // Reset both bootstrap latches whenever the storage bucket
  // identity changes (the consumer swaps in a new lesson with a
  // different variant set, or `variantType` switches the
  // `usePreference` bucket). Without this, a second payload
  // inherits the first payload's "already bootstrapped" state and
  // its newly resolved stored preference is never adopted.
  //
  // The identity is derived from the bucket coordinates — the same
  // values `usePreference` keys off — rather than `effectiveCode`'s
  // object identity. `CodeHighlighterClient` rebuilds and republishes
  // the code object during ordinary parse / transform progress, so
  // keying on `effectiveCode` would re-arm the bootstrap path in
  // the middle of a user-driven swap (whose stored value is
  // persisted eagerly by `setSelectedVariantAsUser`), making an
  // interactive variant change look like an initial-mount stored
  // bootstrap and replaying it again.
  //
  // Tracking the previous identity in state (rather than a ref)
  // follows React's "adjusting state when a prop changes" pattern
  // so the reset stays a synchronous render-time decision without
  // violating the refs-during-render rule.
  const bootstrapIdentity = React.useMemo(
    () => `${variantType ?? ''}\u0000${[...variantKeys].sort().join('\u0001')}`,
    [variantType, variantKeys],
  );
  const [prevBootstrapIdentity, setPrevBootstrapIdentity] = React.useState(bootstrapIdentity);
  if (prevBootstrapIdentity !== bootstrapIdentity) {
    setPrevBootstrapIdentity(bootstrapIdentity);
    // Reset to `false` so the effect re-runs and the resolved value
    // swings from initial → stored on a later tick. Setting it true
    // synchronously here would skip the receiver-flow swap animation
    // for the new bucket — same regression class as bootstrapping
    // synchronously on first render.
    setAllowStoredBootstrap(false);
    setHasCommittedPastInitial(false);
    setInitialCommittedVariantKey(null);
  }
  // A stored-preference bootstrap is only actually pending when no
  // higher-precedence source (the URL hash) is already winning. When
  // the hash takes precedence, the resolved value matches the hash
  // forever and no bootstrap swap will ever fire — gating only on
  // `storedValue !== committedVariantKey` here would leave
  // `pendingBootstrap` latched forever, which `useCode` translates
  // into "never highlight". The hash precedence guard keeps
  // permalinked / hash-selected demos highlighting normally even when
  // the user's saved preference points at a different variant.
  const hashOverridesStorage = !!hashVariant && variantKeys.includes(hashVariant);
  const pendingBootstrap =
    !hasCommittedPastInitial &&
    !hashOverridesStorage &&
    !!storedValue &&
    variantKeys.includes(storedValue) &&
    storedValue !== committedVariantKey;

  // User setter: persists to localStorage (and clears any relevant
  // URL hash) before dispatching the coordinator so peer demos
  // observe the new preference on the same tick as the click.
  // Validation differs from `resolveVariantKey`: an explicit `null`
  // means "fall back to the first variant" — never re-resolved to
  // `initialVariant` (which is only consulted for the
  // never-set-storage hydration path).
  const setSelectedVariantAsUser = React.useCallback(
    (value: React.SetStateAction<string | null>) => {
      const resolved = typeof value === 'function' ? value(selectedVariantKey) : value;
      const effectiveValue = resolved ?? variantKeys[0];
      if (!effectiveValue || !variantKeys.includes(effectiveValue)) {
        return;
      }
      if (effectiveValue === selectedVariantKey && effectiveValue === committedVariantKey) {
        return;
      }
      // Clear hash first so the receiver flow doesn't observe a
      // stale hash → variant mapping after the storage write echoes
      // back through `usePreference`. Only clear when the current
      // hash is one this demo cares about.
      if (urlHash && mainSlug && isHashRelevantToDemo(urlHash, mainSlug)) {
        setUrlHash(null);
      }
      // Start local coordination from the user action first so this
      // demo is always treated as the originator (matching the
      // pattern in `useTransformManagement`), then persist.
      selectVariantDispatch(effectiveValue);
      setStoredValue(effectiveValue);
    },
    [
      selectedVariantKey,
      committedVariantKey,
      variantKeys,
      urlHash,
      mainSlug,
      setUrlHash,
      selectVariantDispatch,
      setStoredValue,
    ],
  );

  // Programmatic setter: doesn't save to localStorage and doesn't
  // clear the hash. Used for hash-driven changes routed through
  // `useFileNavigation`.
  const setSelectedVariantProgrammatic = React.useCallback(
    (value: React.SetStateAction<string>) => {
      const resolved = typeof value === 'function' ? value(selectedVariantKey) : value;
      if (!variantKeys.includes(resolved)) {
        return;
      }
      if (resolved === selectedVariantKey && resolved === committedVariantKey) {
        return;
      }
      selectVariantDispatch(resolved);
    },
    [selectedVariantKey, committedVariantKey, variantKeys, selectVariantDispatch],
  );

  const selectedVariant = React.useMemo(() => {
    const variant = effectiveCode[selectedVariantKey];
    if (variant && typeof variant === 'object' && 'source' in variant) {
      return variant;
    }
    return null;
  }, [effectiveCode, selectedVariantKey]);

  // Variant resolved from the *committed* key — lags `selectedVariant`
  // by `variantSwapDelay` ms when a delay is configured. Used by the
  // renderer so the outgoing tree stays put for the pre-swap window.
  const committedVariant = React.useMemo(() => {
    if (committedVariantKey === selectedVariantKey) {
      return selectedVariant;
    }
    const variant = effectiveCode[committedVariantKey];
    if (variant && typeof variant === 'object' && 'source' in variant) {
      return variant;
    }
    return null;
  }, [effectiveCode, committedVariantKey, selectedVariantKey, selectedVariant]);

  // Post-swap `data-transforming="expanded"`/`"collapsing"` window. Mirrors the
  // equivalent in `useTransformManagement`: fires after the engine
  // commits a swap so the incoming tree has a chance to enter-animate
  // any bridge `.collapse` placeholder appended by `<Pre>`. Only
  // armed when `variantSwapDelay` is configured.
  //
  // `collapseSourceVariantKey` captures the variant we just left at
  // the moment of commit so the post-swap window has a stable bridge
  // target even if `selectedVariantKey` keeps changing.
  const [postSwapWindowActive, setPostSwapWindowActive] = React.useState(false);
  const [collapseSourceVariantKey, setCollapseSourceVariantKey] = React.useState<string | null>(
    null,
  );
  const [prevAppliedVariant, setPrevAppliedVariant] = React.useState(committedVariantKey);
  if (prevAppliedVariant !== committedVariantKey) {
    if (hasDelay && prevAppliedVariant !== '') {
      setPostSwapWindowActive(true);
      setCollapseSourceVariantKey(prevAppliedVariant);
    }
    setPrevAppliedVariant(committedVariantKey);
  }
  // Tear down a stale window synchronously at render time: no animation
  // window should exist without a delay, so a window left open after
  // `hasDelay` flips to false is cleared a tick earlier than an effect would,
  // with no animation to disrupt (there is no delay).
  if (postSwapWindowActive && !hasDelay) {
    setPostSwapWindowActive(false);
    setCollapseSourceVariantKey(null);
  }
  React.useEffect(() => {
    if (!postSwapWindowActive) {
      return undefined;
    }
    const timerId = setTimeout(() => {
      setPostSwapWindowActive(false);
      setCollapseSourceVariantKey(null);
    }, effectiveSwapWindowMs);
    return () => clearTimeout(timerId);
  }, [postSwapWindowActive, effectiveSwapWindowMs, committedVariantKey]);

  // If both phases are technically eligible, the pending pre-swap
  // takes priority — the visible tree IS the just-applied one and it
  // needs to expand out for the next swap. When `variantSwapDelay`
  // isn't configured, no animation window is opening (the coordinator
  // wait is the one-frame `MIN_VARIANT_WAIT_MS`, too short to
  // animate) so the phase stays `null`.
  //
  // Each phase enters a "paused" value first (`'collapsed'` for the
  // pre-swap window, `'expanded'` for the post-swap window). The
  // rendered `<Pre>` calls `notifyVariantTransitionReady` once it has
  // painted the new tree at that paused value, flipping
  // `variantTransitionReady` to `true` which advances the phase to
  // the matching active value (`'expanding'` / `'collapsing'`). The
  // readiness flag is keyed on `(committedVariantKey,
  // selectedVariantKey)` so each new paused window starts with a
  // fresh wait.
  const variantTransitionWindowKey = `${committedVariantKey}|${selectedVariantKey}|${
    postSwapWindowActive ? '1' : '0'
  }`;
  const { ready: variantTransitionReady, notify: notifyVariantTransitionReady } =
    useTransitionPhase(variantTransitionWindowKey);

  const variantSwappingPhase: TransitionPhase = (() => {
    if (!hasDelay) {
      return null;
    }
    if (committedVariantKey !== selectedVariantKey) {
      return variantTransitionReady ? 'expanding' : 'collapsed';
    }
    if (postSwapWindowActive) {
      return variantTransitionReady ? 'collapsing' : 'expanded';
    }
    return null;
  })();

  const swapPartnerVariantKey: string | null = (() => {
    if (variantSwappingPhase === 'collapsed' || variantSwappingPhase === 'expanding') {
      return selectedVariantKey || null;
    }
    if (variantSwappingPhase === 'expanded' || variantSwappingPhase === 'collapsing') {
      return collapseSourceVariantKey;
    }
    return null;
  })();

  const pendingVariantKey: string | undefined = coordinationExtras.isWaitingForPeers
    ? coordinationExtras.pendingValue
    : undefined;

  // Safety check: if the selected variant truly disappears from the
  // code map (e.g. variant keys re-resolved), fall back to the first
  // variant. We deliberately *don't* trip on a key whose entry exists
  // but is still a lazy placeholder (string / partial object without
  // `source`): during incremental loading the variant key is valid,
  // the source just hasn't arrived yet, and bouncing through the
  // coordinator here would round-trip the selection
  // stored → first-variant → stored (the receiver flow re-resolves
  // back to the underlying value the moment the placeholder swaps
  // for a real `VariantCode`). `variantKeys` itself only includes
  // fully-loaded variants, so it's not a reliable signal here.
  const keyExistsInCode = selectedVariantKey
    ? Object.prototype.hasOwnProperty.call(effectiveCode, selectedVariantKey)
    : false;
  React.useEffect(() => {
    if (!keyExistsInCode && variantKeys.length > 0) {
      setSelectedVariantProgrammatic(variantKeys[0]);
    }
  }, [keyExistsInCode, variantKeys, setSelectedVariantProgrammatic]);

  // Function to save variant to localStorage (used for on-interaction mode)
  const saveVariantToLocalStorage = React.useCallback(
    (variant: string) => {
      if (saveHashVariantToLocalStorage === 'on-interaction' && variant !== storedValue) {
        setStoredValue(variant);
      }
    },
    [saveHashVariantToLocalStorage, storedValue, setStoredValue],
  );

  return {
    variantKeys,
    selectedVariantKey,
    selectedVariant,
    committedVariantKey,
    committedVariant,
    variantSwappingPhase,
    swapPartnerVariantKey,
    pendingVariantKey,
    pendingBootstrap,
    notifyVariantTransitionReady,
    selectVariant: setSelectedVariantAsUser,
    selectVariantProgrammatic: setSelectedVariantProgrammatic,
    saveVariantToLocalStorage,
    hashVariant,
  };
}

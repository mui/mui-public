import * as React from 'react';
import type { Code, VariantCode } from '../CodeHighlighter/types';
import { usePreference } from '../usePreference';
import { useUrlHashState } from '../useUrlHashState';
import { useCoordinated } from '../useCoordinated';
import { isHashRelevantToDemo } from './useFileNavigation';
import { toKebabCase } from '../pipeline/loaderUtils/toKebabCase';
import { variantHasLayoutShift } from './useCodeUtils';

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
   * Direction of the in-flight variant-swap animation, or `null` when
   * settled. Always `null` when `variantSwapDelay` is not set or is
   * `0`. Mirrors `useTransformManagement`'s `transformingPhase`:
   *
   *   - `'expand'`   the outgoing variant's tree is still rendered
   *                  and any bridge `.collapse` placeholder appended
   *                  by `<Pre>` should expand from 0 to the incoming
   *                  variant's extra line count before the swap.
   *   - `'collapse'` the incoming variant's tree is now rendered and
   *                  any bridge `.collapse` placeholder appended by
   *                  `<Pre>` should collapse from the outgoing
   *                  variant's extra line count down to 0.
   */
  variantSwappingPhase: 'expand' | 'collapse' | null;
  /**
   * The "other" variant key participating in the in-flight swap:
   *   - During `'expand'`: the incoming variant (the user's intent
   *     target, equal to `selectedVariantKey`).
   *   - During `'collapse'`: the outgoing variant we just transitioned
   *     away from, captured at the commit boundary.
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

  // When a delay is configured and an explicit `initialVariant` exists,
  // start from that initial value for one render, then adopt the stored
  // value on the next tick as a normal coordinated receiver swap. This
  // allows the initial→stored transition to open `data-transforming`
  // windows instead of resolving to stored before first paint.
  const [allowStoredBootstrap, setAllowStoredBootstrap] = React.useState(false);
  React.useEffect(() => {
    setAllowStoredBootstrap(true);
  }, []);

  // Barrier wait length. Falls back to one frame when
  // `variantSwapDelay` isn't configured so peers still align on the
  // same paint without making the click feel sluggish.
  const hasDelay = typeof variantSwapDelay === 'number' && variantSwapDelay > 0;
  const effectiveSwapWindowMs = hasDelay ? variantSwapDelay : MIN_VARIANT_WAIT_MS;

  const storedValueForResolve =
    hasDelay && initialVariant && !allowStoredBootstrap ? null : storedValue;

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

  const [committedVariantKey, selectVariantDispatch, coordinationExtras] = useCoordinated<
    string,
    void
  >(underlying, {
    channelKey,
    peerId: demoId,
    causesLayoutShift,
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

  // Post-swap `data-transforming="collapse"` window. Mirrors the
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
  React.useEffect(() => {
    if (!postSwapWindowActive) {
      return undefined;
    }
    if (!hasDelay) {
      setPostSwapWindowActive(false);
      setCollapseSourceVariantKey(null);
      return undefined;
    }
    const timerId = setTimeout(() => {
      setPostSwapWindowActive(false);
      setCollapseSourceVariantKey(null);
    }, effectiveSwapWindowMs);
    return () => clearTimeout(timerId);
  }, [postSwapWindowActive, hasDelay, effectiveSwapWindowMs, committedVariantKey]);

  // If both phases are technically eligible, the pending pre-swap
  // takes priority — the visible tree IS the just-applied one and it
  // needs to expand out for the next swap. When `variantSwapDelay`
  // isn't configured, no animation window is opening (the coordinator
  // wait is the one-frame `MIN_VARIANT_WAIT_MS`, too short to
  // animate) so the phase stays `null`.
  const variantSwappingPhase: 'expand' | 'collapse' | null = (() => {
    if (!hasDelay) {
      return null;
    }
    if (committedVariantKey !== selectedVariantKey) {
      return 'expand';
    }
    if (postSwapWindowActive) {
      return 'collapse';
    }
    return null;
  })();

  const swapPartnerVariantKey: string | null = (() => {
    if (variantSwappingPhase === 'expand') {
      return selectedVariantKey || null;
    }
    if (variantSwappingPhase === 'collapse') {
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
    selectVariant: setSelectedVariantAsUser,
    selectVariantProgrammatic: setSelectedVariantProgrammatic,
    saveVariantToLocalStorage,
    hashVariant,
  };
}

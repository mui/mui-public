'use client';

import * as React from 'react';
import type {
  CoordinatedFallbackContextValue,
  UseCoordinatedSwapOptions,
  UseCoordinatedSwapResult,
} from './types';
import { CoordinatedFallbackContext } from './CoordinatedFallbackContext';
import { CoordinatedGateContext } from './CoordinatedGateContext';
import { useSettleGate } from '../useCoordinated/useSettleGate';
import { pageSettleGate } from '../useCoordinated/pageSettleGate';

/**
 * The generalized fallback<->content swap state machine extracted from
 * `CodeHighlighterClient`. Decides whether to show the fallback or the content,
 * owns the force-mount-once behavior, collects data hoisted up from the
 * fallback, suppresses nested-fallback flicker, and registers with a settle
 * gate so the page can coordinate when every initial swap has landed.
 *
 * `showFallback` is the generalization of `isFallbackRendered`:
 * ```ts
 * hasFallback && !skipFallback && (
 *   !ready || defer || isNested || !fallbackMounted || (requireHoist && !hasHoisted)
 * )
 * ```
 */
export function useCoordinatedSwap(options: UseCoordinatedSwapOptions): UseCoordinatedSwapResult {
  const {
    ready,
    defer = false,
    holdGate = false,
    hasFallback,
    skipFallback = false,
    requireHoist = false,
    awaitContent = false,
    gate,
    data,
  } = options;

  // Nested inside an outer instance's still-loading fallback? Suppress our own
  // swap so the page collapses to a single fallback->content transition.
  const isNested = React.useContext(CoordinatedFallbackContext) !== undefined;

  // The gate this swap registers with: the explicit `gate` option wins,
  // otherwise the ambient gate a surrounding coordinator (e.g. the `useChunks`
  // controller) provided - so a group's `loading` reflects this swap without a
  // `gate` prop threaded through.
  const ambientGate = React.useContext(CoordinatedGateContext);
  const effectiveGate = gate ?? ambientGate;

  const [fallbackMounted, setFallbackMounted] = React.useState(false);
  const [hoisted, setHoisted] = React.useState<Record<string, unknown>>({});
  const hasHoisted = Object.keys(hoisted).length > 0;

  // In `awaitContent` mode the content is mounted behind the fallback and loads
  // in the background (e.g. a `LazyContent` returning `null`); it calls
  // `reportContentReady` once loaded so the swap can reveal it.
  const [contentReady, setContentReady] = React.useState(false);
  const reportContentReady = React.useCallback(() => setContentReady(true), []);

  const showFallback =
    hasFallback &&
    !skipFallback &&
    (!ready ||
      defer ||
      isNested ||
      !fallbackMounted ||
      (requireHoist && !hasHoisted) ||
      (awaitContent && !contentReady));

  // Force-mount-once: after the first commit in which a fallback exists, allow
  // the swap. Owned here rather than driven by the fallback calling a hook, so
  // any fallback works. A fallback's own hoist effect is a child effect, so it
  // runs before this parent effect - hoisted data is in place by the time we
  // flip `fallbackMounted` and the swap proceeds.
  React.useEffect(() => {
    if (!fallbackMounted && hasFallback && !skipFallback) {
      setFallbackMounted(true);
    }
  }, [fallbackMounted, hasFallback, skipFallback]);

  // Speculative preload: fire as soon as the fallback hoists data so the
  // consumer can start dynamic imports of helpers it can tell it will need, in
  // parallel with loading the full content. The callback is synced into a ref
  // (the "latest ref" idiom) so an inline `preload` doesn't re-run the fire
  // effect on identity change - its dep is the hoisted data, not the callback.
  const preloadRef = React.useRef(options.preload);
  React.useEffect(() => {
    preloadRef.current = options.preload;
  });
  React.useEffect(() => {
    if (hasHoisted) {
      preloadRef.current?.(hoisted);
    }
  }, [hoisted, hasHoisted]);

  const hoist = React.useCallback((key: string, value: unknown) => {
    setHoisted((prev) => {
      if (Object.is(prev[key], value)) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const onReady = React.useCallback(() => {
    setFallbackMounted(true);
  }, []);

  const fallbackContext = React.useMemo<CoordinatedFallbackContextValue>(
    () => ({ hoist, onReady, isNested, data }),
    [hoist, onReady, isNested, data],
  );

  // Register with the page-global gate so a page-wide coordinated commit waits
  // for this swap, and additionally with an explicit (controller) gate when
  // provided so a `ChunksController`'s `loading` reflects this swap too. Both
  // release once we've swapped (and aren't deferring); a no-fallback instance
  // settles immediately.
  // `holdGate` keeps the gate open while the content stays rendered (e.g. the
  // code highlighter deferring its highlight pass in place), distinct from
  // `defer` which holds the fallback.
  const settled = !showFallback && !defer && !holdGate;
  useSettleGate(settled, pageSettleGate);
  useSettleGate(settled, effectiveGate ?? null);

  return {
    showFallback,
    fallbackContext,
    hoisted,
    loading: showFallback,
    contentReady,
    reportContentReady,
    hoist,
  };
}

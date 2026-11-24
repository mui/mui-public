'use client';

import * as React from 'react';
import { isHighlighterLoaded, loadHighlighter } from '../pipeline/parseSource/highlighterCache';

// Safety-net deadline (ms) for the engine load. A load that HANGS (a stalled dynamic
// import that never settles) — rather than rejecting — would otherwise leave `ready`
// false forever, wedging the block un-highlighted until a reload. After the deadline we
// fail open (plain text) just like a hard rejection.
const HIGHLIGHTER_LOAD_TIMEOUT_MS = 10_000;

/**
 * Gates client-side highlighting on the highlighting engine. Under
 * `CodeProviderLazy` the engine loads on demand, so a block must wait until it is
 * loaded — otherwise `parseSource` cannot run. Returning `false` keeps the block
 * showing its fallback until the engine lands (then it highlights), instead of
 * flashing plain text.
 *
 * Readiness is read synchronously from the shared singleton each render, so it
 * is `true` immediately when the engine is already loaded (warm — the
 * speculative preload, a sibling block, or an eager `CodeProvider` loaded it)
 * and a warm block never holds back its highlight. When cold, it kicks off the
 * load and re-renders once ready.
 *
 * @param enabled - Whether the block will highlight client-side at all
 */
export function useHighlighterReady(enabled: boolean): boolean {
  const [, forceUpdate] = React.useReducer((count: number) => count + 1, 0);
  // Set once the load has definitively failed (a hard chunk-fetch error or a hang), so
  // the block fails OPEN — renders plain text — instead of wedging on `ready === false`.
  const [failed, setFailed] = React.useState(false);

  const loaded = isHighlighterLoaded();
  const ready = !enabled || loaded || failed;

  React.useEffect(() => {
    if (!enabled || loaded) {
      return undefined;
    }
    let cancelled = false;
    const failOpen = () => {
      if (!cancelled) {
        setFailed(true);
      }
    };
    const timer = setTimeout(failOpen, HIGHLIGHTER_LOAD_TIMEOUT_MS);
    (async () => {
      try {
        await loadHighlighter();
        // Loaded now — re-render so `ready` recomputes to true.
        if (!cancelled) {
          forceUpdate();
        }
      } catch {
        failOpen();
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, loaded]);

  return ready;
}

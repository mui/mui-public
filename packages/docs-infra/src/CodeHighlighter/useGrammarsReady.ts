'use client';

import * as React from 'react';
import { areGrammarsRegistered, ensureGrammars } from '../pipeline/parseSource/grammarCache';

/**
 * Gates client-side highlighting on grammar readiness. Under `CodeProviderLazy`,
 * grammars load per-language and on demand, so a block must wait until the
 * grammars for its scopes are registered — otherwise `parseSource` would fall
 * back to plain text. Returning `false` keeps the block showing its fallback
 * until the grammars land (then it highlights), instead of flashing the cold
 * plain-text output.
 *
 * Readiness is derived synchronously from the shared registry each render, so it
 * is `true` immediately when the scopes are already registered (warm — the
 * speculative preload primed them, a sibling block loaded them, or an eager
 * `CodeProvider` bundled them) and a warm block never holds back its highlight.
 * When cold, it kicks off the load and re-renders once ready.
 *
 * @param scopes - Grammar scopes the block needs (should be memoized by the caller)
 * @param enabled - Whether the block will highlight client-side at all
 */
export function useGrammarsReady(scopes: string[], enabled: boolean): boolean {
  const [, forceUpdate] = React.useReducer((count: number) => count + 1, 0);

  // Nothing to wait for when disabled or when every scope is already registered.
  const ready = !enabled || areGrammarsRegistered(scopes);

  React.useEffect(() => {
    if (ready) {
      return undefined;
    }
    let cancelled = false;
    // Fails open: a load error still flips ready so the block highlights what it
    // can (and renders plain text for any scope that failed to register).
    ensureGrammars(scopes).finally(() => {
      if (!cancelled) {
        forceUpdate();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, scopes]);

  return ready;
}

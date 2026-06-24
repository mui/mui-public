'use client';

import * as React from 'react';
import { areGrammarsRegistered, ensureGrammars } from '../pipeline/parseSource/grammarCache';

// Safety-net deadline (ms) for the grammar load. A load that HANGS (a stalled dynamic
// import that never settles) — rather than rejecting — would otherwise leave `ready`
// false forever, wedging the block un-highlighted until a reload. After the deadline we
// fail open (plain text) just like a hard rejection.
const GRAMMAR_LOAD_TIMEOUT_MS = 10_000;

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
  // The scopes whose grammar load has definitively FAILED (a hard chunk-fetch error,
  // not a partial register). Tracked so the block can fail OPEN — render plain text for
  // those scopes — instead of wedging on `ready === false` forever (which would leave
  // the code permanently un-highlighted until a reload). Stored as a CONTENT key (the
  // joined scopes), not a reference, so it stays matched if the caller passes a fresh
  // array — and a different set of scopes (a new language) still retries.
  const [failedScopesKey, setFailedScopesKey] = React.useState<string | null>(null);

  // Nothing to wait for when disabled or when every scope is already registered.
  const registered = areGrammarsRegistered(scopes);
  const scopesKey = scopes.join('\n');
  const ready = !enabled || registered || failedScopesKey === scopesKey;

  React.useEffect(() => {
    if (!enabled || registered) {
      return undefined;
    }
    let cancelled = false;
    // Fail open on a hard rejection (catch) OR a hang (the timer): a grammar load that
    // never settles would otherwise leave `ready` false forever — the same wedge.
    const failOpen = () => {
      if (!cancelled) {
        setFailedScopesKey(scopes.join('\n'));
      }
    };
    const timer = setTimeout(failOpen, GRAMMAR_LOAD_TIMEOUT_MS);
    (async () => {
      try {
        await ensureGrammars(scopes);
        // Registered now — re-render so `ready` recomputes to true.
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
  }, [enabled, registered, scopes]);

  return ready;
}

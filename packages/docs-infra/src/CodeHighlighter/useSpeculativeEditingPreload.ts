'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { preloadCodeEmphasis } from '../pipeline/enhanceCodeEmphasis/enhanceCodeEmphasisLazy';

/**
 * On first render, when a block will be editable (a `CodeControllerContext` with
 * `setCode` is in scope), kick off the editing-engine load so it is already in
 * flight before the user interacts. Mirrors {@link useSpeculativeCodePreload}:
 * the detection is cheap and synchronous, the loader runs in a mount effect (so
 * it never blocks first paint), and the fetch is deduped page-wide with the
 * eventual consumer's (`useEditable`).
 *
 * Calling the accessor is instant under an eager `CodeProvider` and starts a
 * deduped fetch under `CodeProviderLazy` (the same promise `useEditable`
 * resolves). A read-only page sets `enabled = false`, so the editing engine is
 * never prefetched where it won't be used.
 *
 * `editActivation: 'interaction'` opts out of the prefetch entirely: that mode
 * defers the engine load until the reader engages the block, so preloading on
 * mount would defeat it. Under `'eager'` (the default) the prefetch runs.
 */
export function useSpeculativeEditingPreload({
  enabled,
  editActivation,
  scopes,
}: {
  enabled: boolean;
  editActivation?: 'eager' | 'interaction';
  /**
   * Grammar scopes the editable block uses, so the worker can be warmed with the
   * grammars it needs for live re-highlighting (should be memoized by the caller).
   */
  scopes?: string[];
}): void {
  const { editableEngineLoader, ensureParseSourceWorker } = useCodeContext();

  React.useEffect(() => {
    // Best-effort head start; swallow rejections (the real consumer surfaces any
    // load error). `?.()?.catch` no-ops cleanly when no provider supplies the
    // accessor. Blocks set to `'interaction'` prefetch nothing here — they load
    // the engine on engage.
    if (enabled && (editActivation ?? 'eager') !== 'interaction') {
      editableEngineLoader?.()?.catch(() => {});
      // Warm the emphasis enhancer too, so the first live-edit re-enhancement
      // (a synchronous render-path) runs without a flash under `CodeProviderLazy`.
      preloadCodeEmphasis().catch(() => {});
      // Spin up the worker (lazily) with this block's grammars, so off-main-thread
      // highlighting is ready before the first keystroke. No-op without a worker
      // (no provider, SSR, or no `Worker`).
      if (scopes && scopes.length > 0) {
        ensureParseSourceWorker?.(scopes);
      }
    }
  }, [enabled, editActivation, editableEngineLoader, ensureParseSourceWorker, scopes]);
}

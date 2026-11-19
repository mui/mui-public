'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { preloadCodeEmphasis } from '../pipeline/enhanceCodeEmphasis/enhanceCodeEmphasisLazy';
import { loadHighlighter } from '../pipeline/parseSource/highlighterCache';
import { preloadCodeEditor } from '../useCode/codeEditorCache';

/**
 * Warms ALL the live-editing dependencies a block needs — the textarea editor,
 * the highlighting engine, the emphasis
 * enhancer, and the off-main-thread worker — so they are in flight before the
 * user edits. Mirrors {@link useSpeculativeCodePreload}: detection is cheap and
 * synchronous, the work runs in a mount/activation effect (never blocking first
 * paint), and each fetch is deduped page-wide with the eventual consumer.
 *
 * Timing follows `editActivation`:
 * - `'eager'` (default): warms on mount once the block is `enabled` (editable).
 * - `'interaction'`: warms only once the block is `activated` — the editor
 *   fires `onActivate` on first engagement (hover / focus / click), and
 *   `CodeHighlighter` flips `activated`. This is the single moment that kicks off
 *   every editing dependency, rather than each loading on its own trigger.
 *
 * A read-only block sets `enabled = false` and warms nothing.
 */
export function useSpeculativeEditingPreload({
  enabled,
  editActivation,
  activated = false,
}: {
  enabled: boolean;
  editActivation?: 'eager' | 'interaction';
  /** Whether an `'interaction'` block has engaged yet (ignored when `'eager'`). */
  activated?: boolean;
}): void {
  const { codeEditorLoader, ensureParseSourceWorker } = useCodeContext();

  // In `'interaction'` mode, wait for engagement; otherwise warm on mount.
  const shouldWarm = enabled && ((editActivation ?? 'eager') !== 'interaction' || activated);

  React.useEffect(() => {
    // Best-effort head start; swallow rejections (the real consumers surface any
    // load error). `?.()?.catch` no-ops cleanly when no provider supplies the
    // accessor.
    if (!shouldWarm) {
      return;
    }
    preloadCodeEditor(codeEditorLoader).catch(() => {});
    // Warm the emphasis enhancer too, so the first live-edit re-enhancement
    // (a synchronous render-path) runs without a flash under `CodeProviderLazy`.
    preloadCodeEmphasis().catch(() => {});
    // The main-thread engine for the edited file...
    loadHighlighter().catch(() => {});
    // ...and the (lazily-created) worker, so off-main-thread highlighting is ready
    // before the first keystroke. No-op without a worker (no provider, SSR, or no
    // `Worker`).
    void ensureParseSourceWorker?.();
  }, [shouldWarm, codeEditorLoader, ensureParseSourceWorker]);
}

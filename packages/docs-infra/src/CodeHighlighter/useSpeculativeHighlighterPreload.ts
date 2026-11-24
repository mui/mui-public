'use client';

import * as React from 'react';
import { loadHighlighter } from '../pipeline/parseSource/highlighterCache';

/**
 * On first render, start loading the highlighting engine when a block is about
 * to highlight client-side, so it is in flight before `useCode` mounts and the
 * parse runs. Mirrors {@link useSpeculativeCodePreload} /
 * {@link useSpeculativeUseCodePreload}: the load runs in a mount effect (so it
 * never blocks first paint), and `loadHighlighter` dedupes with the eventual
 * consumer (`useHighlighterReady`) and is a no-op when warm.
 *
 * A fully-precomputed read-only block (which renders its highlighted HAST and
 * never calls `parseSource`) sets `enabled = false` and loads nothing.
 *
 * @param enabled - Whether the block will highlight client-side (or live-edit)
 */
export function useSpeculativeHighlighterPreload(enabled: boolean): void {
  React.useEffect(() => {
    // Best-effort head start; swallow rejections (the consumer surfaces any real
    // load error, and the block degrades to plain text). No-op when warm.
    if (enabled) {
      loadHighlighter().catch(() => {});
    }
  }, [enabled]);
}

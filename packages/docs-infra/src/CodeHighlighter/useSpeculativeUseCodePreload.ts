'use client';

import * as React from 'react';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { preloadTransformEngine } from '../useCode/transformEngineCache';

/**
 * On first render, kick off the heavy `useCode` chunks a block is about to need,
 * so they are already in flight before the content subtree mounts and
 * `useCode`/`useTransformManagement` awaits them. Mirrors
 * {@link useSpeculativeCodePreload} / {@link useSpeculativeEditingPreload}: the
 * detection is cheap and synchronous, the loaders run in a mount effect (so they
 * never block first paint), and each fetch is deduped page-wide with the eventual
 * consumer (the speculative preload and the consumer resolve the same promise).
 *
 * Where `CodeContent` is itself lazily loaded, this effect fires on the same
 * commit as the content `import()`, so the chunks download concurrently rather
 * than waterfalling (content → discover need → fetch).
 *
 * Signals are deliberately accurate so a block that needs nothing prefetches
 * nothing: a block with no transforms never pulls the transform engine (the
 * `jsondiffpatch` applier).
 */
export function useSpeculativeUseCodePreload({ hasTransforms }: { hasTransforms: boolean }): void {
  const { transformEngineLoader } = useCodeContext();

  React.useEffect(() => {
    // Prime the shared transform-engine cache (not just kick off the fetch), so
    // the first transform-bearing block reads it synchronously and never flashes
    // un-transformed files. `preloadTransformEngine` shares the provider's loader
    // (page-wide dedup) and fails open. Runs in parallel with the lazy content
    // import, so the cache is typically warm before `useTransformManagement` first
    // renders. Passing the context loader keeps it deduped with the consumer.
    if (hasTransforms) {
      preloadTransformEngine(transformEngineLoader).catch(() => {});
    }
  }, [hasTransforms, transformEngineLoader]);
}

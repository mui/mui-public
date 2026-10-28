'use client';

import * as React from 'react';
import { ChunkContext } from './ChunkContext';
import type { ChunkContextValue, ChunkProviderProps } from './types';
import type { StreamSource } from '../CoordinatedLazy/types';

/**
 * Layout-level provider that supplies a client `StreamSource` to descendant
 * chunks, dynamically importing the loader module only when a chunk first needs
 * to load - so the loaders stay out of the initial bundle and are never
 * imported when chunks are precomputed/preloaded. The import promise is cached,
 * so many chunks share one fetch (mirrors how `CodeProvider` lazily provides
 * its parser/loaders).
 */
export function ChunkProvider<P, O>({
  children,
  source,
}: ChunkProviderProps<P, O>): React.ReactElement {
  // Hold the in-flight/resolved import so the first caller triggers the import
  // and the rest reuse its promise. Written only inside the callback (never
  // during render).
  const cacheRef = React.useRef<Promise<StreamSource<P, O>> | null>(null);

  const resolveSource = React.useCallback(() => {
    if (!cacheRef.current) {
      cacheRef.current = source().then((loaded) => loaded.default);
    }
    return cacheRef.current;
  }, [source]);

  const value = React.useMemo<ChunkContextValue<P, O>>(() => ({ resolveSource }), [resolveSource]);

  // The context is intentionally `unknown`-generic; consumers narrow at the use
  // site. Casting here is the one untyped seam for the provider's generics.
  return (
    <ChunkContext.Provider value={value as ChunkContextValue}>{children}</ChunkContext.Provider>
  );
}

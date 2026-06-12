import type * as React from 'react';
import type { StreamSource } from '../CoordinatedLazy/types';

/**
 * Provided by a `ChunkProvider`: lazily resolve the client `StreamSource` for
 * descendant chunks. Called only when a chunk actually needs to load (i.e. it
 * was not preloaded), so the loader module stays out of the initial bundle and
 * is never imported when everything is precomputed.
 */
export interface ChunkContextValue<P = unknown, O = unknown> {
  resolveSource: () => Promise<StreamSource<P, O>>;
}

/** Props for {@link ChunkProvider}. */
export interface ChunkProviderProps<P = unknown, O = unknown> {
  children: React.ReactNode;
  /**
   * Dynamic import of the client source module - its `default` export is the
   * {@link StreamSource}. Imported once, lazily, on the first chunk that needs
   * to load; the resolved promise is shared across descendants.
   */
  source: () => Promise<{ default: StreamSource<P, O> }>;
}

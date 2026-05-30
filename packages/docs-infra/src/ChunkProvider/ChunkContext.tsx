'use client';

import * as React from 'react';
import type { ChunkContextValue } from './types';

/**
 * Supplies the lazily-resolved client `StreamSource` to descendant chunks.
 * `undefined` outside a `ChunkProvider` - a chunk then relies on its own config
 * source (or stays in its loading/preloaded state).
 */
export const ChunkContext = React.createContext<ChunkContextValue | undefined>(undefined);

/** Read the surrounding `ChunkProvider`, or `undefined` when there is none. */
export function useChunkContext(): ChunkContextValue | undefined {
  return React.useContext(ChunkContext);
}

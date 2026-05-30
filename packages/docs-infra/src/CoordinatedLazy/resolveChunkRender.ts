import type { ChunkRenderDecision, ChunkRenderInputs } from './types';

/**
 * Pure render-decision for a chunk. Given already-evaluated inputs (so it is
 * decoupled from the config shape and the `isLoaded`/`isInitial` predicate
 * signatures), picks which branch to render:
 *
 * - `isLoaded` -> render the full content.
 * - else `isInitial` -> the server initial loader, else the source initial, else
 *   `null` (the client loads it).
 * - else -> the server loader, else the source loader, else attempt the initial
 *   data on the client.
 *
 * Server providers win over source functions in each branch (so a precomputed
 * server render is preferred), and `isLoaded` wins over `isInitial`.
 */
export function resolveChunkRender(inputs: ChunkRenderInputs): ChunkRenderDecision {
  const {
    isLoaded,
    isInitial,
    hasServerInitial,
    hasSourceInitial,
    hasServerLoader,
    hasSourceLoader,
  } = inputs;

  if (isLoaded) {
    return { mode: 'content', loading: false };
  }

  if (isInitial) {
    if (hasServerInitial) {
      return { mode: 'server-initial', loading: true };
    }
    if (hasSourceInitial) {
      return { mode: 'async-initial', loading: true };
    }
    return { mode: 'null-client', loading: true };
  }

  if (hasServerLoader) {
    return { mode: 'server-loader', loading: true };
  }
  if (hasSourceLoader) {
    return { mode: 'async-loader', loading: true };
  }
  return { mode: 'attempt-initial-client', loading: true };
}

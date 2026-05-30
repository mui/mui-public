import type { ChunkRenderDecision, ChunkRenderInputs } from './types';

/**
 * Pure render-decision for a chunk. Given already-evaluated inputs (so it is
 * decoupled from the config shape and the `isLoaded`/`isInitial` predicate
 * signatures), picks which branch to render.
 *
 * The key distinction is between *having* a paint and *fetching* one:
 *
 * - `isLoaded` -> the full content is in hand -> render it (not loading).
 * - `isInitial` -> the **initial paint is already in hand** (but not the full
 *   content). The initial is the fallback, so we never fetch another one; we
 *   load the full content behind it (server loader, else source loader), or,
 *   when there is no full loader, render the content directly and let it own the
 *   client swap (`content-initial`).
 * - otherwise (no paint in hand at all) -> fetch a quick initial first (server
 *   `InitialLoader`, else source initial), else skip straight to loading the
 *   full content, else let the client attempt the initial data.
 *
 * Server providers win over source functions in each branch (so a precomputed
 * server render is preferred). `isLoaded` wins over everything; a fetched
 * initial wins over loading the full so the user sees something fast.
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

  // The initial paint is already in hand: it is the fallback. Load the full
  // content behind it, or render the content (loading) and let it own the swap.
  if (isInitial) {
    if (hasServerLoader) {
      return { mode: 'server-loader', loading: true };
    }
    if (hasSourceLoader) {
      return { mode: 'async-loader', loading: true };
    }
    return { mode: 'content-initial', loading: true };
  }

  // Nothing in hand: fetch a quick initial first if we can, else load the full,
  // else let the client attempt it.
  if (hasServerInitial) {
    return { mode: 'server-initial', loading: true };
  }
  if (hasSourceInitial) {
    return { mode: 'async-initial', loading: true };
  }
  if (hasServerLoader) {
    return { mode: 'server-loader', loading: true };
  }
  if (hasSourceLoader) {
    return { mode: 'async-loader', loading: true };
  }
  return { mode: 'attempt-initial-client', loading: true };
}

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
 *   load the full content behind it (a server loader: `Loader` or a data
 *   `source.load`), or, when there is none, render the content directly and let
 *   it own the client swap (`content-initial`).
 * - otherwise (no paint in hand at all) -> render a quick initial first on the
 *   server (server `InitialLoader` or data `source.initial`), else load the full
 *   on the server, else let the client attempt it (loading via a `ChunkProvider`).
 *
 * The loader functions on the config (`source`/`Loader`/`InitialLoader`) all run
 * on the SERVER (`buildChunkRenderInputs` folds a `data`-mode `source` into the
 * server flags), so a source never produces a client mode; `attempt-initial-client`
 * is reached only when no server provider applies, and it loads from a
 * `ChunkProvider` source on the client. `isLoaded` wins over everything; a quick
 * initial wins over the full load so the user sees something fast.
 */
export function resolveChunkRender(inputs: ChunkRenderInputs): ChunkRenderDecision {
  const { isLoaded, isInitial, hasServerInitial, hasServerLoader } = inputs;

  if (isLoaded) {
    return { mode: 'content', loading: false };
  }

  // The initial paint is already in hand: it is the fallback. Load the full
  // content behind it on the server, or render the content (loading) and let it
  // own the swap.
  if (isInitial) {
    if (hasServerLoader) {
      return { mode: 'server-loader', loading: true };
    }
    return { mode: 'content-initial', loading: true };
  }

  // Nothing in hand: render a quick initial on the server if we can, else load
  // the full on the server, else let the client attempt it.
  if (hasServerInitial) {
    return { mode: 'server-initial', loading: true };
  }
  if (hasServerLoader) {
    return { mode: 'server-loader', loading: true };
  }
  return { mode: 'attempt-initial-client', loading: true };
}

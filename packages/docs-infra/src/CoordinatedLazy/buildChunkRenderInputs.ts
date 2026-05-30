import type { ChunkComponentProps, ChunkRenderInputs, CreateChunkConfig } from './types';

/**
 * Evaluate a chunk's config + per-instance props into the already-resolved
 * {@link ChunkRenderInputs} that {@link resolveChunkRender} consumes. Pure, so
 * the same inputs drive the render decision identically on the server and the
 * client's first render. Mirrors the `isLoaded` rule {@link useChunk} uses.
 */
export function buildChunkRenderInputs<T extends {}, P, O>(
  config: CreateChunkConfig<T, P, O>,
  props: ChunkComponentProps<T, P, O>,
): ChunkRenderInputs {
  const { preloaded, controlled } = props;

  const isLoaded =
    Boolean(controlled) || (config.isLoaded ? config.isLoaded(preloaded) : preloaded !== undefined);
  const isInitial = config.isInitial ? config.isInitial(preloaded) : false;

  const source = config.source;
  const hasSourceInitial = Boolean(
    source &&
    ((source.mode === 'data' && source.initial) || (source.mode === 'urls' && source.initialUrls)),
  );

  return {
    isLoaded,
    isInitial,
    hasServerInitial: Boolean(config.InitialLoader),
    hasSourceInitial,
    hasServerLoader: Boolean(config.Loader),
    hasSourceLoader: Boolean(source),
  };
}

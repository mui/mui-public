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
  const { preloaded, controlled, forceClient, skipInitialLoad } = props;

  const isLoaded =
    Boolean(controlled) || (config.isLoaded ? config.isLoaded(preloaded) : preloaded !== undefined);
  // A per-render `props.isInitial` override wins over the config predicate, for
  // consumers whose initial-readiness depends on context they cannot express as
  // a pure `config.isInitial(preloaded)`.
  const isInitial = props.isInitial ?? (config.isInitial ? config.isInitial(preloaded) : false);

  const source = config.source;
  const hasSourceInitial =
    !skipInitialLoad &&
    Boolean(
      source &&
      ((source.mode === 'data' && source.initial) ||
        (source.mode === 'urls' && source.initialUrls)),
    );

  // `forceClient` opts out of the server render paths for this render (the server
  // `Loader`/`InitialLoader` are ignored). `skipInitialLoad` additionally drops
  // the initial-loader stage so a not-yet-loaded chunk loads the full content
  // directly. Source (client) full loaders are unaffected by `forceClient`.
  return {
    isLoaded,
    isInitial,
    hasServerInitial: !forceClient && !skipInitialLoad && Boolean(config.InitialLoader),
    hasSourceInitial,
    hasServerLoader: !forceClient && Boolean(config.Loader),
    hasSourceLoader: Boolean(source),
  };
}

import type { ChunkComponentProps, ChunkRenderInputs, CreateChunkConfig } from './types';

/**
 * Evaluate a chunk's config + per-instance props into the already-resolved
 * {@link ChunkRenderInputs} that `resolveChunkRender` consumes. Pure, so
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

  // A `data`-mode `source` is a SERVER loader (run by `ChunkServerLoader`), so it
  // folds into the server flags alongside `Loader`/`InitialLoader` - it never
  // drives a client mode. (`urls`/`stream` sources have no server-execution branch
  // yet, so they set no server flag; supply them via a `ChunkProvider` to load on
  // the client.) `forceClient` opts a source out of the server path too, exactly
  // like `Loader`/`InitialLoader`; such a chunk falls to the client path and loads
  // via a `ChunkProvider`. `skipInitialLoad` drops the initial stage.
  const source = config.source;
  const dataSource = source && source.mode === 'data' ? source : undefined;

  return {
    isLoaded,
    isInitial,
    hasServerInitial:
      !forceClient && !skipInitialLoad && Boolean(config.InitialLoader || dataSource?.initial),
    hasServerLoader: !forceClient && Boolean(config.Loader || dataSource),
  };
}

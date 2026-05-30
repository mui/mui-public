'use client';

import * as React from 'react';
import type { ChunkComponentProps, ChunkSource, CreateChunkConfig } from './types';
import { useChunkContext } from '../ChunkProvider/ChunkContext';

/** Result of {@link useChunk}. */
export interface UseChunkResult<P> {
  /** The chunk's data: the loaded value, or the initial/preloaded value while loading. */
  data: P | undefined;
  /** `true` until the full data has loaded. */
  loading: boolean;
}

/**
 * Load a single chunk's data on the client (props-context-layering: when the
 * data already arrived via `preloaded`, no fetch happens). Handles the
 * `controlled`/`preloaded` short-circuit and a quick `initial` value shown while
 * the full `data`-mode `load` resolves.
 *
 * Used by the component {@link createCoordinatedLazy} produces; consumers can
 * also call it directly for a custom chunk renderer.
 */
export function useChunk<T extends {}, P, O>(
  config: CreateChunkConfig<T, P, O>,
  props: ChunkComponentProps<T, P, O> = {},
): UseChunkResult<P> {
  const { preloaded, controlled } = props;
  const options = (props.loaderOptions ?? config.loaderOptions) as O;
  const chunkContext = useChunkContext();

  const isLoaded =
    Boolean(controlled) || (config.isLoaded ? config.isLoaded(preloaded) : preloaded !== undefined);

  // The value shown while loading: the preloaded value if present, otherwise a
  // quick `initial` computed by a `data`-mode source.
  const initialData = React.useMemo<P | undefined>(() => {
    if (preloaded !== undefined) {
      return preloaded;
    }
    const source = config.source;
    if (source && source.mode === 'data' && source.initial) {
      return source.initial(options);
    }
    return undefined;
  }, [preloaded, config, options]);

  const [data, setData] = React.useState<P | undefined>(isLoaded ? preloaded : initialData);
  const [loading, setLoading] = React.useState<boolean>(!isLoaded);

  React.useEffect(() => {
    if (isLoaded) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    (async () => {
      try {
        // Prefer the config source; otherwise fall back to a `ChunkProvider`'s
        // lazily-imported source (props-context-layering). The provider only
        // imports the loader module here - never when the chunk is preloaded.
        let source = config.source;
        if (!source && chunkContext) {
          source = (await chunkContext.resolveSource()) as ChunkSource<P, O>;
        }
        // Only a `data`-mode source loads a single chunk on the client; `urls` /
        // `stream` sources are driven by `useChunks` at the list level.
        if (!source || source.mode !== 'data') {
          return;
        }
        const result = await source.load(options, controller.signal);
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      } catch {
        // Aborted by a newer load, or the load failed - leave the loading
        // state in place for the consumer's fallback / a retry.
      }
    })();
    return () => controller.abort();
  }, [isLoaded, config, options, chunkContext]);

  return { data, loading };
}

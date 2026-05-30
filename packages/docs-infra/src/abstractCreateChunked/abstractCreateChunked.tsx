import * as React from 'react';
import { createCoordinatedLazy } from '../CoordinatedLazy/createCoordinatedLazy';
import type { AbstractCreateChunkedOptions, CreateChunkedMeta } from './types';

/**
 * Factory-factory for chunked objects, mirroring `abstractCreateDemo`. Binds the
 * chunk config and produces a component that renders the chunk with the build-
 * time `precompute` (from `meta`) injected as its preloaded data - so a
 * precomputed chunk renders directly, and a non-precomputed one falls back to
 * the config's loaders.
 *
 * The `url` is the call-site identity (from `import.meta.url`) used by the
 * build-time loader to inject `precompute`; it is not needed at runtime.
 */
export function abstractCreateChunked<T extends {}, P = unknown, O = unknown>(
  options: AbstractCreateChunkedOptions<T, P, O>,
  url: string,
  meta?: CreateChunkedMeta<P, O>,
): React.ComponentType<T> {
  const { ClientProvider, ...config } = options;
  const Chunk = createCoordinatedLazy<T, P, O>(config);
  const preloaded = meta?.precompute;
  const loaderOptions = meta?.loaderOptions;

  function ChunkedObject(userProps: T): React.ReactElement {
    const chunk = (
      <Chunk preloaded={preloaded} loaderOptions={loaderOptions} userProps={userProps} />
    );
    if (ClientProvider) {
      return <ClientProvider>{chunk}</ClientProvider>;
    }
    return chunk;
  }
  ChunkedObject.displayName = 'ChunkedObject';
  return ChunkedObject;
}

/**
 * Bind chunk options once and get a `createChunkedObject(url, meta?)` entry
 * point (mirrors `createDemoFactory` -> `createDemo`).
 */
export function createChunkedFactory<T extends {}, P = unknown, O = unknown>(
  options: AbstractCreateChunkedOptions<T, P, O>,
) {
  return (url: string, meta?: CreateChunkedMeta<P, O>): React.ComponentType<T> =>
    abstractCreateChunked(options, url, meta);
}

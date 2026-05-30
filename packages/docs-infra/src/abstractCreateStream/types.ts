import type * as React from 'react';
import type { CreateChunkConfig } from '../CoordinatedLazy/types';

/**
 * Options bound by {@link createStreamFactory}. Extends the chunk config with
 * an optional client provider (e.g. a `ChunkProvider` supplying client loaders,
 * or a `PreloadProvider`) wrapped around the chunk.
 *
 * All loader functions on the config are expected to be dynamically imported by
 * the caller's module, so they can be bundled (and never called) on the client;
 * add `import 'server-only'` to a loader module to keep a sensitive loader off
 * the client entirely.
 */
export interface AbstractCreateStreamOptions<
  T extends {} = {},
  P = unknown,
  O = unknown,
> extends CreateChunkConfig<T, P, O> {
  /** Client provider wrapped around the chunk (loaders, preload dedup, etc.). */
  ClientProvider?: React.ComponentType<{ children: React.ReactNode }>;
}

/**
 * Per-call metadata, injected by the build-time loader (mirrors
 * `CreateDemoMeta`). `precompute` is the chunk's build-time data, rendered
 * directly without a client fetch.
 */
export interface CreateStreamMeta<P = unknown, O = unknown> {
  name?: string;
  slug?: string;
  displayName?: string;
  /** Skip build-time precomputation for this call. */
  skipPrecompute?: boolean;
  /** Build-time precomputed value, rendered as the chunk's data. */
  precompute?: P;
  /** Default loader options for this call. */
  loaderOptions?: O;
}

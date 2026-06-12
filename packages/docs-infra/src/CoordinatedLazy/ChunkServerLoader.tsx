import * as React from 'react';
import type {
  ChunkComponentProps,
  ChunkContentProps,
  ChunkLoadingProps,
  CreateChunkConfig,
} from './types';

/**
 * Server render path for a chunk: an async server component that produces the
 * content on the server, to be rendered under a Suspense boundary so React
 * streams the fallback until it resolves (per-chunk Suspense). It is a plain
 * async render function (no Node-only imports), so it bundles harmlessly with
 * the client surface - it just never runs there.
 *
 * With `initial`, it renders the server `InitialLoader` (the quick initial
 * state). Otherwise it prefers the server `Loader` component (dynamically
 * imported, never shipped to the client), falling back to a server-side
 * `data`-mode `load`. When none applies it renders the loading placeholder (the
 * client then takes over).
 *
 * Readiness/coordination is a client concern, so there is no gate here - the
 * parent Suspense owns the fallback, and the streamed content hydrates into the
 * client swap.
 */
export async function ChunkServerLoader<T extends {}, P, O>(args: {
  config: CreateChunkConfig<T, P, O>;
  props?: ChunkComponentProps<T, P, O>;
  /** Render the server `InitialLoader` (the quick initial state) instead of the full `Loader`. */
  initial?: boolean;
}): Promise<React.ReactElement | null> {
  const { config, props = {}, initial = false } = args;
  const options = (props.loaderOptions ?? config.loaderOptions) as O;
  const userProps = (props.userProps ?? {}) as T;

  // Server initial: render the InitialLoader's quick state (still `loading`, as
  // the full data is not in yet - a client source can upgrade it afterwards).
  if (initial && config.InitialLoader) {
    const loaded = await config.InitialLoader();
    const Loaded = loaded.default;
    const loadingProps = {
      ...userProps,
      data: props.preloaded,
      loading: true,
    } as ChunkLoadingProps<T, P>;
    return <Loaded {...loadingProps} />;
  }

  // Server initial from a `data`-mode source: compute the quick `initial()` value
  // (synchronous, no await) on the server and render it into `ChunkContent` still
  // marked `loading`. `source.initial()` must return serializable data, since
  // `ChunkContent` may be a Client Component. `InitialLoader` above wins when both
  // are present.
  if (initial && config.source && config.source.mode === 'data' && config.source.initial) {
    const data = config.source.initial(options);
    const ChunkContent = config.ChunkContent;
    const loadingProps = { ...userProps, data, loading: true } as ChunkLoadingProps<T, P>;
    return <ChunkContent {...loadingProps} />;
  }

  if (!initial && config.Loader) {
    const loaded = await config.Loader();
    const Loaded = loaded.default;
    const contentProps = {
      ...userProps,
      data: props.preloaded,
      loading: false,
    } as ChunkContentProps<T, P>;
    return <Loaded {...contentProps} />;
  }

  if (!initial && config.source && config.source.mode === 'data') {
    const data = await config.source.load(options, new AbortController().signal);
    const ChunkContent = config.ChunkContent;
    const contentProps = { ...userProps, data, loading: false } as ChunkContentProps<T, P>;
    return <ChunkContent {...contentProps} />;
  }

  const ChunkLoading = config.ChunkLoading;
  if (ChunkLoading) {
    const loadingProps = {
      ...userProps,
      data: props.preloaded,
      loading: true,
    } as ChunkLoadingProps<T, P>;
    return <ChunkLoading {...loadingProps} />;
  }
  return null;
}

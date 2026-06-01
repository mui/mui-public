'use client';

import * as React from 'react';
import type {
  ChunkComponentProps,
  ChunkContentProps,
  ChunkLoadingProps,
  CreateChunkConfig,
} from './types';
import { useChunk } from './useChunk';
import { CoordinatedLazy } from './CoordinatedLazy';

function RenderNull(): null {
  return null;
}

/** Props for {@link CoordinatedLazyClient}. */
export interface CoordinatedLazyClientProps<T extends {}, P, O> {
  config: CreateChunkConfig<T, P, O>;
  props: ChunkComponentProps<T, P, O>;
}

/**
 * The client-loading half of {@link createCoordinatedLazy}: loads the piece's
 * data on the client via {@link useChunk}, shows `ChunkLoading` until it is
 * ready, then swaps to `ChunkContent` through {@link CoordinatedLazy}. The
 * isomorphic router renders this only for the client-driven render modes, so the
 * content/loading components here are always client components.
 */
export function CoordinatedLazyClient<T extends {}, P, O>({
  config,
  props,
}: CoordinatedLazyClientProps<T, P, O>): React.ReactElement {
  const ChunkContent = config.ChunkContent;
  const ChunkLoading = config.ChunkLoading ?? RenderNull;

  const { data, loading, revalidating, refresh } = useChunk(config, props);
  const userProps = (props.userProps ?? {}) as T;

  // Spreading the generic `T` alongside the fixed fields needs an assertion; the
  // shape matches `ChunkContentProps<T, P>` / `ChunkLoadingProps<T, P>`. The
  // content also receives `refresh`/`revalidating` so it can trigger a
  // stale-while-revalidate reload.
  const contentProps = {
    ...userProps,
    data,
    loading: false,
    refresh,
    revalidating,
  } as ChunkContentProps<T, P>;
  const loadingProps = { ...userProps, data, loading: true } as ChunkLoadingProps<T, P>;

  // `gate` is left to `CoordinatedLazy`: an explicit `props.gate` wins, otherwise
  // it registers with the ambient controller gate (if any).
  return (
    <CoordinatedLazy
      ready={!loading}
      defer={config.swap?.defer}
      requireHoist={config.swap?.requireHoist}
      gate={props.gate}
      content={<ChunkContent {...contentProps} />}
      fallback={<ChunkLoading {...loadingProps} />}
    />
  );
}

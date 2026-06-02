import * as React from 'react';
import type {
  ChunkComponentProps,
  ChunkContentProps,
  ChunkLoadingProps,
  CreateChunkConfig,
} from './types';
import { buildChunkRenderInputs } from './buildChunkRenderInputs';
import { resolveChunkRender } from './resolveChunkRender';
import { ChunkServerLoader } from './ChunkServerLoader';
import { CoordinatedLazyClient } from './CoordinatedLazyClient';

function RenderNull(): null {
  return null;
}

/**
 * Build a self-loading {@link CoordinatedLazy} component. The returned component
 * is **isomorphic**: per render it evaluates {@link buildChunkRenderInputs} and
 * routes via `resolveChunkRender`, so one component covers build, server,
 * and client loading, and server or client rendering:
 *
 * - **content** (preloaded/controlled) - renders `ChunkContent` directly, so
 *   build-precomputed data lands in the server HTML. `ChunkContent` may be a
 *   server OR client component here.
 * - **server-loader / server-initial** - renders the server `ChunkServerLoader`
 *   under a Suspense boundary (server `Loader`/`InitialLoader` or a server-side
 *   `data`-mode load), so content loads and renders on the server and streams
 *   in. Requires a server (RSC) render context; supports server-component content.
 * - **client modes** (async/initial/null) - delegates to the `'use client'`
 *   {@link CoordinatedLazyClient}, which loads on the client and swaps the
 *   fallback to content. `ChunkContent` here must be a client component.
 *
 * The client-mode branch hands the (function-bearing) `config` to a `'use client'`
 * component, so a client-loaded chunk must render inside a client subtree - call
 * `createCoordinatedLazy` from a client module, or wrap it in a client provider
 * (e.g. `abstractCreateStream`'s `ClientProvider`). Server-loaded and
 * preloaded/precomputed chunks have no such constraint - they render entirely on
 * the server path.
 *
 * The user's generic props `T` flow through to both components; `data` (type
 * `P`) is the loaded value (or the initial value while loading). Use it
 * standalone for any deferred piece (a demo, a chart, a code frame); `useStream`
 * renders a streamed list of them.
 */
export function createCoordinatedLazy<T extends {} = {}, P = unknown, O = unknown>(
  config: CreateChunkConfig<T, P, O>,
): React.ComponentType<ChunkComponentProps<T, P, O>> {
  const ChunkContent = config.ChunkContent;
  const ChunkLoading = config.ChunkLoading ?? RenderNull;

  function CoordinatedLazyContent(props: ChunkComponentProps<T, P, O>): React.ReactElement {
    const decision = resolveChunkRender(buildChunkRenderInputs(config, props));
    const userProps = (props.userProps ?? {}) as T;

    // Render the content directly so it is part of the server HTML (no framework
    // swap):
    // - `content` (loaded/precomputed/controlled): settled, not loading.
    // - `content-initial`: the initial paint is in hand and there is no full
    //   loader, so render the content from the initial (still `loading`). The
    //   content owns any further client-side load + swap itself.
    if (decision.mode === 'content' || decision.mode === 'content-initial') {
      // Spreading the generic `T` alongside fixed fields needs an assertion; the
      // shape matches `ChunkContentProps<T, P>`.
      const contentProps = {
        ...userProps,
        data: props.preloaded,
        loading: decision.loading,
      } as ChunkContentProps<T, P>;
      return <ChunkContent {...contentProps} />;
    }

    // Server load (server `Loader`/`InitialLoader` or a server-side `data` load).
    // `ChunkServerLoader` is a plain async component; this branch is taken only
    // when a server loader is configured.
    if (decision.mode === 'server-loader' || decision.mode === 'server-initial') {
      const serverLoader = (
        <ChunkServerLoader
          config={config}
          props={props}
          initial={decision.mode === 'server-initial'}
        />
      );
      // `awaitServerLoad` blocks the server render on the loader (no Suspense) so
      // its content lands in the initial HTML; otherwise stream a fallback.
      if (props.awaitServerLoad) {
        return serverLoader;
      }
      const loadingProps = {
        ...userProps,
        data: props.preloaded,
        loading: true,
      } as ChunkLoadingProps<T, P>;
      return (
        <React.Suspense fallback={<ChunkLoading {...loadingProps} />}>
          {serverLoader}
        </React.Suspense>
      );
    }

    // Client-driven mode (attempt-initial-client, or a forceClient opt-out).
    // When the content manages its own client load + swap, render it directly
    // (loading) rather than wrapping it in the framework's load+swap, so it is
    // not double-swapped.
    if (config.contentManagesSwap) {
      const contentProps = {
        ...userProps,
        data: props.preloaded,
        loading: true,
      } as ChunkContentProps<T, P>;
      return <ChunkContent {...contentProps} />;
    }

    // Otherwise load on the client and swap via the framework. Strip the
    // server-only loader functions (`source`/`Loader`/`InitialLoader`) so they can
    // never be serialized into the 'use client' `CoordinatedLazyClient` - the RSC
    // "Functions cannot be passed to Client Components" guard, enforced by its
    // `ClientChunkConfig` param. A client-loaded chunk gets its source from a
    // surrounding `ChunkProvider` instead.
    const { source, Loader, InitialLoader, ...clientConfig } = config;
    return <CoordinatedLazyClient config={clientConfig} props={props} />;
  }

  CoordinatedLazyContent.displayName = 'CoordinatedLazyContent';
  return CoordinatedLazyContent;
}

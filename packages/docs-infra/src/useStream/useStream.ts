'use client';

import * as React from 'react';
import type { StreamSource } from './types';
import { streamChunks } from './streamChunks';
import { useStreamController } from './useStreamController';

/** Options for {@link useStream}. */
export interface UseStreamOptions<P, O> {
  /**
   * The source that produces the chunk list, by `mode`: `urls` resolves the
   * chunk URLs then loads each, `stream` pushes chunks over time, `data` yields
   * a single chunk. Streamed snapshots accumulate into `chunks`.
   */
  source: StreamSource<P, O>;
  /** Options passed to the source loaders. */
  loaderOptions?: O;
  /** Coordination channel forwarded to the owned controller. */
  channelKey?: string | null;
}

/** Result of {@link useStream}. */
export interface UseStreamResult<P> {
  /** The chunks loaded so far, accumulating as they stream in. */
  chunks: P[];
  /** Controller provider that scopes the rendered chunks' coordination. */
  Controller: React.ComponentType<{ children: React.ReactNode }>;
  /** `true` until the list has finished streaming and every chunk has settled. */
  loading: boolean;
  /** `true` once the list has finished streaming (the last chunk arrived). */
  streamComplete: boolean;
}

/**
 * Stream a list of chunks on the client and own a `StreamController` that scopes
 * their coordination. Render the returned `chunks` as chunk components inside
 * the returned `Controller`; each chunk registers its swap with the controller,
 * and the list's completion (`markLast`) plus those swaps drive `loading`.
 *
 * The controller runs in `streaming` mode, so it stays `loading` until the list
 * finishes streaming - at which point the chunks present can settle it.
 */
export function useStream<P, O>(options: UseStreamOptions<P, O>): UseStreamResult<P> {
  const { source, loaderOptions, channelKey } = options;
  const {
    Controller,
    loading: controllerLoading,
    markLast,
  } = useStreamController({ streaming: true, channelKey });

  const [chunks, setChunks] = React.useState<P[]>([]);
  const [streamComplete, setStreamComplete] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const stream = streamChunks(source, loaderOptions as O, controller.signal);
        // Snapshots accumulate and reveal in order as the source streams.
        for await (const snapshot of stream) {
          if (controller.signal.aborted) {
            return;
          }
          setChunks(snapshot.chunks);
          if (snapshot.lastChunk) {
            setStreamComplete(true);
            markLast();
          }
        }
      } catch {
        // Stream aborted by a newer run, or the loader failed.
      }
    })();
    return () => controller.abort();
    // Re-stream only when the source identity changes; options are read once at
    // stream start, and `markLast` is stable for the controller's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Loading until the list has finished streaming AND every rendered chunk has
  // settled. The controller's `loading` only reflects chunk swaps (it settles
  // immediately when no chunks have registered yet), so combine it with the
  // list-streaming state.
  const loading = !streamComplete || controllerLoading;

  return { chunks, Controller, loading, streamComplete };
}

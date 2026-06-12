'use client';

import * as React from 'react';
import type { StreamSource } from './types';
import { streamChunks } from './streamChunks';
import { useStreamController } from './useStreamController';
import { requestIdle } from '../useCoordinated/scheduleTasks';

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
  /**
   * Opt into stale-while-revalidate: once the list has finished streaming,
   * automatically {@link UseStreamResult.refresh} it once on the first idle
   * period (via `requestIdleCallback`). Client-only; the current list stays
   * visible while the background re-stream runs.
   */
  revalidateOnIdle?: boolean;
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
  /** `true` while a background re-stream (revalidation) is in flight; the current list stays. */
  revalidating: boolean;
  /**
   * Re-stream the list in the background and swap the fresh list in atomically
   * once it completes, keeping the current list visible meanwhile
   * (stale-while-revalidate). Aborts any prior in-flight refresh.
   */
  refresh: () => void;
}

/**
 * Stream a list of chunks on the client and own a `StreamController` that scopes
 * their coordination. Render the returned `chunks` as chunk components inside
 * the returned `Controller`; each chunk registers its swap with the controller,
 * and the list's completion (`markLast`) plus those swaps drive `loading`.
 *
 * The controller runs in `streaming` mode, so it stays `loading` until the list
 * finishes streaming - at which point the chunks present can settle it.
 *
 * `refresh()` (and the opt-in `revalidateOnIdle`) re-stream the list in the
 * background and swap the result in atomically when it completes, without a
 * loading flash — the current list stays visible the whole time.
 */
export function useStream<P, O>(options: UseStreamOptions<P, O>): UseStreamResult<P> {
  const { source, loaderOptions, channelKey, revalidateOnIdle } = options;
  const {
    Controller,
    loading: controllerLoading,
    markLast,
  } = useStreamController({ streaming: true, channelKey });

  const [chunks, setChunks] = React.useState<P[]>([]);
  const [streamComplete, setStreamComplete] = React.useState(false);
  const [revalidating, setRevalidating] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);

  // Set by `refresh()` so the stream effect can tell a background revalidation
  // (keep the current list, swap on complete) from an initial / source-change
  // stream (reveal progressively). Read-and-cleared at the start of the effect.
  const refreshRef = React.useRef(false);
  const refresh = React.useCallback(() => {
    refreshRef.current = true;
    setRefreshToken((token) => token + 1);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    const isRefresh = refreshRef.current;
    refreshRef.current = false;
    if (isRefresh) {
      setRevalidating(true);
    }
    (async () => {
      try {
        const stream = streamChunks(source, loaderOptions as O, controller.signal);
        // Snapshots accumulate and reveal in order as the source streams.
        let latest: P[] = [];
        for await (const snapshot of stream) {
          if (controller.signal.aborted) {
            return;
          }
          latest = snapshot.chunks;
          // Initial / source-change: reveal progressively. A background refresh
          // holds the current list and swaps once below (stale-while-revalidate).
          if (!isRefresh) {
            setChunks(snapshot.chunks);
            if (snapshot.lastChunk) {
              setStreamComplete(true);
              markLast();
            }
          }
        }
        if (isRefresh && !controller.signal.aborted) {
          setChunks(latest);
          setRevalidating(false);
        }
      } catch {
        // Stream aborted by a newer run, or the loader failed.
        if (isRefresh && !controller.signal.aborted) {
          setRevalidating(false);
        }
      }
    })();
    return () => controller.abort();
    // Re-stream when the source identity changes or a refresh is requested;
    // options are read once at stream start, and `markLast` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, refreshToken]);

  // Opt-in stale-while-revalidate: once the list has finished streaming,
  // revalidate in the background on the first idle period. Browser-only.
  React.useEffect(() => {
    if (!revalidateOnIdle || !streamComplete || typeof window === 'undefined') {
      return undefined;
    }
    return requestIdle(() => refresh());
  }, [revalidateOnIdle, streamComplete, refresh]);

  // Loading until the list has finished streaming AND every rendered chunk has
  // settled. The controller's `loading` only reflects chunk swaps (it settles
  // immediately when no chunks have registered yet), so combine it with the
  // list-streaming state.
  const loading = !streamComplete || controllerLoading;

  return { chunks, Controller, loading, streamComplete, revalidating, refresh };
}

import type { ChunkSource } from './types';

/** A snapshot emitted by {@link streamChunkSource} after each chunk lands. */
export interface ChunkSnapshot<P> {
  /** All chunks loaded so far, in order. */
  chunks: P[];
  /** `true` on the snapshot that completes the stream (last-chunk signal). */
  lastChunk: boolean;
}

/**
 * Drive any {@link ChunkSource} `mode` and yield an accumulating snapshot after
 * each chunk lands. Isomorphic: the client (`useChunks`) iterates it and
 * `setState`s each snapshot for progressive reveal; the server awaits it to
 * completion for non-incremental modes.
 *
 * - `'data'` - one `load`, one terminal snapshot.
 * - `'urls'` - `loadUrls`, then `loadChunk` per URL, one snapshot each; the
 *   final URL is the last chunk unless `loadUrls` returned `lastChunk: false`.
 * - `'stream'` - runs the generator (which pushes into the array and yields),
 *   surfacing a snapshot per yield, then a terminal snapshot on return.
 *
 * Stops early (without a terminal snapshot) if `signal` aborts.
 */
export async function* streamChunkSource<P, O>(
  source: ChunkSource<P, O>,
  options: O,
  signal: AbortSignal,
): AsyncGenerator<ChunkSnapshot<P>, void, void> {
  if (source.mode === 'data') {
    const data = await source.load(options, signal);
    if (signal.aborted) {
      return;
    }
    yield { chunks: [data], lastChunk: true };
    return;
  }

  if (source.mode === 'urls') {
    const result = await source.loadUrls(options, signal);
    if (signal.aborted) {
      return;
    }
    const urls = result.chunks;
    const accumulated: P[] = [];
    for (let index = 0; index < urls.length; index += 1) {
      // Sequential by design: chunks stream in and yield in order for
      // progressive reveal - loading in parallel would defeat that.
      // eslint-disable-next-line no-await-in-loop
      const data = await source.loadChunk(urls[index], options, signal);
      if (signal.aborted) {
        return;
      }
      accumulated.push(data);
      const isLast = index === urls.length - 1 && result.lastChunk !== false;
      yield { chunks: [...accumulated], lastChunk: isLast };
    }
    if (urls.length === 0) {
      // Nothing to load - still signal completion so a controller can settle.
      yield { chunks: [], lastChunk: result.lastChunk !== false };
    }
    return;
  }

  // stream mode: the generator pushes into `accumulated` and yields after each.
  const accumulated: P[] = [];
  const generator = source.stream(accumulated, options, signal);
  let step = await generator.next();
  while (!step.done) {
    if (signal.aborted) {
      return;
    }
    yield { chunks: [...accumulated], lastChunk: false };
    // Sequential by design: a generator is driven one step at a time.
    // eslint-disable-next-line no-await-in-loop
    step = await generator.next();
  }
  if (signal.aborted) {
    return;
  }
  // Generator returned -> the stream is complete.
  yield { chunks: [...accumulated], lastChunk: true };
}

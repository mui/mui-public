import { describe, it, expect } from 'vitest';
import { streamChunkSource, type ChunkSnapshot } from './streamChunkSource';
import type { ChunkSource } from './types';

/** Collect every snapshot a source emits. */
async function collect<P, O>(
  source: ChunkSource<P, O>,
  options: O,
  signal: AbortSignal = new AbortController().signal,
): Promise<ChunkSnapshot<P>[]> {
  const out: ChunkSnapshot<P>[] = [];
  for await (const snapshot of streamChunkSource(source, options, signal)) {
    out.push(snapshot);
  }
  return out;
}

describe('streamChunkSource', () => {
  describe("'data' mode", () => {
    it('loads once and emits a single terminal snapshot', async () => {
      const source: ChunkSource<string, { id: number }> = {
        mode: 'data',
        load: async (options) => `data-${options.id}`,
      };
      const snapshots = await collect(source, { id: 7 });
      expect(snapshots).toEqual([{ chunks: ['data-7'], lastChunk: true }]);
    });
  });

  describe("'urls' mode", () => {
    it('loads each URL and accumulates, marking the final URL as last', async () => {
      const source: ChunkSource<string> = {
        mode: 'urls',
        loadUrls: async () => ({
          chunks: [new URL('https://x/1'), new URL('https://x/2'), new URL('https://x/3')],
        }),
        loadChunk: async (url) => url.pathname.slice(1),
      };
      const snapshots = await collect(source, undefined);
      expect(snapshots).toEqual([
        { chunks: ['1'], lastChunk: false },
        { chunks: ['1', '2'], lastChunk: false },
        { chunks: ['1', '2', '3'], lastChunk: true },
      ]);
    });

    it('honors loadUrls returning lastChunk: false (stays incomplete)', async () => {
      const source: ChunkSource<string> = {
        mode: 'urls',
        loadUrls: async () => ({ chunks: [new URL('https://x/1')], lastChunk: false }),
        loadChunk: async (url) => url.pathname.slice(1),
      };
      const snapshots = await collect(source, undefined);
      expect(snapshots).toEqual([{ chunks: ['1'], lastChunk: false }]);
    });

    it('emits a terminal empty snapshot when there are no URLs', async () => {
      const source: ChunkSource<string> = {
        mode: 'urls',
        loadUrls: async () => ({ chunks: [] }),
        loadChunk: async () => 'unused',
      };
      const snapshots = await collect(source, undefined);
      expect(snapshots).toEqual([{ chunks: [], lastChunk: true }]);
    });
  });

  describe("'stream' mode", () => {
    it('surfaces a snapshot per yield and a terminal snapshot on return', async () => {
      const source: ChunkSource<number> = {
        mode: 'stream',
        async *stream(chunks) {
          chunks.push(1);
          chunks.push(2);
          yield;
          chunks.push(3);
          yield;
        },
      };
      const snapshots = await collect(source, undefined);
      expect(snapshots).toEqual([
        { chunks: [1, 2], lastChunk: false },
        { chunks: [1, 2, 3], lastChunk: false },
        { chunks: [1, 2, 3], lastChunk: true },
      ]);
    });
  });

  describe('abort', () => {
    it('stops early without a terminal snapshot when aborted mid-stream', async () => {
      const controller = new AbortController();
      const source: ChunkSource<string> = {
        mode: 'urls',
        loadUrls: async () => ({ chunks: [new URL('https://x/1'), new URL('https://x/2')] }),
        loadChunk: async (url) => {
          if (url.pathname === '/2') {
            controller.abort();
          }
          return url.pathname.slice(1);
        },
      };
      const snapshots = await collect(source, undefined, controller.signal);
      // First chunk yielded; second aborts during load -> no further snapshots.
      expect(snapshots).toEqual([{ chunks: ['1'], lastChunk: false }]);
    });
  });
});

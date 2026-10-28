import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { ChunkServerLoader } from './ChunkServerLoader';
import type { ChunkContentProps, CreateChunkConfig } from './types';

interface Point {
  v: number;
}

function ChunkContent({ data }: ChunkContentProps<{}, Point>) {
  return <div>{JSON.stringify(data)}</div>;
}

describe('ChunkServerLoader', () => {
  it('renders a server Loader component when configured', async () => {
    function Loaded() {
      return <div>loaded</div>;
    }
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      Loader: () => Promise.resolve({ default: Loaded }),
    };

    const element = await ChunkServerLoader({ config });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    expect(element.type).toBe(Loaded);
  });

  it('loads a data-mode source on the server and renders ChunkContent with the data', async () => {
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      source: { mode: 'data', load: async () => ({ v: 42 }) },
    };

    const element = await ChunkServerLoader({ config });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    expect(element.type).toBe(ChunkContent);
    expect((element.props as ChunkContentProps<{}, Point>).data).toEqual({ v: 42 });
    expect((element.props as ChunkContentProps<{}, Point>).loading).toBe(false);
  });

  it('prefers a server Loader over the source when both are present', async () => {
    function Loaded() {
      return <div>loaded</div>;
    }
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      Loader: () => Promise.resolve({ default: Loaded }),
      source: { mode: 'data', load: async () => ({ v: 1 }) },
    };

    const element = await ChunkServerLoader({ config });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    expect(element.type).toBe(Loaded);
  });

  it('with initial, renders the server InitialLoader as the loading state', async () => {
    function Initial() {
      return <div>initial</div>;
    }
    function FullLoaded() {
      return <div>full</div>;
    }
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      Loader: () => Promise.resolve({ default: FullLoaded }),
      InitialLoader: () => Promise.resolve({ default: Initial }),
    };

    const element = await ChunkServerLoader({ config, initial: true });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    // Picks the InitialLoader (not the full Loader) and marks it still loading.
    expect(element.type).toBe(Initial);
    expect((element.props as ChunkContentProps<{}, Point>).loading).toBe(true);
  });

  it('with initial, renders source.initial() into ChunkContent (still loading) when no InitialLoader', async () => {
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      source: { mode: 'data', load: async () => ({ v: 42 }), initial: () => ({ v: 7 }) },
    };

    const element = await ChunkServerLoader({ config, initial: true });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    // The quick initial value is computed on the server and rendered into
    // ChunkContent, still marked loading (the full load has not run yet).
    expect(element.type).toBe(ChunkContent);
    expect((element.props as ChunkContentProps<{}, Point>).data).toEqual({ v: 7 });
    expect((element.props as ChunkContentProps<{}, Point>).loading).toBe(true);
  });

  it('with initial, prefers the server InitialLoader over a source.initial when both exist', async () => {
    function Initial() {
      return <div>initial</div>;
    }
    const config: CreateChunkConfig<{}, Point> = {
      ChunkContent,
      InitialLoader: () => Promise.resolve({ default: Initial }),
      source: { mode: 'data', load: async () => ({ v: 1 }), initial: () => ({ v: 2 }) },
    };

    const element = await ChunkServerLoader({ config, initial: true });
    if (!element) {
      throw new Error('expected a rendered element');
    }
    // The InitialLoader wins; source.initial is not used.
    expect(element.type).toBe(Initial);
  });
});

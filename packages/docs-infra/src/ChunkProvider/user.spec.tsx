/**
 * @vitest-environment jsdom
 *
 * Integration tests for `ChunkProvider` - supplying a lazily-imported client
 * source to chunks that have no config source, and skipping the import entirely
 * when a chunk is preloaded.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChunkProvider } from './ChunkProvider';
import { createCoordinatedLazy } from '../CoordinatedLazy/createCoordinatedLazy';
import type { ChunkContentProps, ChunkSource } from '../CoordinatedLazy/types';
import { createSettleGate } from '../useCoordinated/createSettleGate';

afterEach(cleanup);

interface Point {
  v: number;
}

function ChunkContent({ data }: ChunkContentProps<{}, Point>) {
  return <div data-testid="content">{JSON.stringify(data)}</div>;
}
function ChunkLoading() {
  return <div data-testid="loading">loading</div>;
}

describe('ChunkProvider', () => {
  it('lazily imports the source and a config-less chunk loads through it', async () => {
    const source: ChunkSource<Point> = { mode: 'data', load: async () => ({ v: 11 }) };
    const importSource = vi.fn(() => Promise.resolve({ default: source }));
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });

    render(
      <ChunkProvider source={importSource}>
        <Chunk gate={createSettleGate()} />
      </ChunkProvider>,
    );

    expect(screen.getByTestId('loading')).toBeTruthy();
    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":11}');
    expect(importSource).toHaveBeenCalledTimes(1);
  });

  it('never imports the source when the chunk is preloaded', async () => {
    const importSource = vi.fn(() =>
      Promise.resolve({
        default: { mode: 'data', load: async () => ({ v: 0 }) } as ChunkSource<Point>,
      }),
    );
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });

    render(
      <ChunkProvider source={importSource}>
        <Chunk preloaded={{ v: 99 }} gate={createSettleGate()} />
      </ChunkProvider>,
    );

    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":99}');
    expect(importSource).not.toHaveBeenCalled();
  });
});

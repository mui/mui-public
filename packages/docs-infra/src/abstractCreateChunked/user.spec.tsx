/**
 * @vitest-environment jsdom
 *
 * Integration tests for the chunked-object factory - how `createChunkedFactory`
 * binds config once and produces components that render from build-time
 * `precompute` or fall back to the config's loaders.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { createChunkedFactory } from './abstractCreateChunked';
import type { ChunkContentProps } from '../CoordinatedLazy/types';

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

describe('createChunkedFactory / abstractCreateChunked', () => {
  it('renders directly from build-time precompute without a loader', async () => {
    const createChunkedObject = createChunkedFactory<{}, Point>({ ChunkContent, ChunkLoading });
    const Chunked = createChunkedObject('file:///example/index.ts', { precompute: { v: 3 } });

    render(<Chunked />);
    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":3}');
  });

  it('falls back to the config loader when no precompute is provided', async () => {
    let resolve!: (value: Point) => void;
    const load = () =>
      new Promise<Point>((resolveLoad) => {
        resolve = resolveLoad;
      });
    const createChunkedObject = createChunkedFactory<{}, Point>({
      ChunkContent,
      ChunkLoading,
      source: { mode: 'data', load },
    });
    const Chunked = createChunkedObject('file:///example/index.ts');

    render(<Chunked />);
    expect(screen.getByTestId('loading')).toBeTruthy();

    await act(async () => {
      resolve({ v: 8 });
      await Promise.resolve();
    });
    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":8}');
  });

  it('wraps the chunk in a ClientProvider when configured', async () => {
    function ClientProvider({ children }: { children: React.ReactNode }) {
      return <div data-testid="provider">{children}</div>;
    }
    const createChunkedObject = createChunkedFactory<{}, Point>({
      ChunkContent,
      ChunkLoading,
      ClientProvider,
    });
    const Chunked = createChunkedObject('file:///example/index.ts', { precompute: { v: 1 } });

    render(<Chunked />);
    expect(await screen.findByTestId('provider')).toBeTruthy();
    expect(screen.getByTestId('content').textContent).toBe('{"v":1}');
  });
});

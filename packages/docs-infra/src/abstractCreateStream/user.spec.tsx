/**
 * @vitest-environment jsdom
 *
 * Integration tests for the chunked-object factory - how `createStreamFactory`
 * binds config once and produces components that render from build-time
 * `precompute` or fall back to the config's loaders.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createStreamFactory } from './abstractCreateStream';
import { ChunkProvider } from '../ChunkProvider';
import type { ChunkContentProps, StreamSource } from '../CoordinatedLazy/types';

interface Point {
  v: number;
}

function ChunkContent({ data }: ChunkContentProps<{}, Point>) {
  return <div data-testid="content">{JSON.stringify(data)}</div>;
}
function ChunkLoading() {
  return <div data-testid="loading">loading</div>;
}

describe('createStreamFactory / abstractCreateStream', () => {
  it('renders directly from build-time precompute without a loader', async () => {
    const createStream = createStreamFactory<{}, Point>({ ChunkContent, ChunkLoading });
    const Stream = createStream('file:///example/index.ts', { precompute: { v: 3 } });

    render(<Stream />);
    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":3}');
  });

  it('falls back to a ChunkProvider source (via ClientProvider) when no precompute is provided', async () => {
    // A config `source` runs on the server; client-side loading comes from a
    // `ChunkProvider`. The factory's `ClientProvider` is the place to wire one.
    // Create the deferred promise up front (not lazily inside `load`): the
    // ChunkProvider imports the source before calling `load`, so `resolve` must
    // exist regardless of when `load` runs.
    let resolve!: (value: Point) => void;
    const promise = new Promise<Point>((resolveLoad) => {
      resolve = resolveLoad;
    });
    const source: StreamSource<Point> = { mode: 'data', load: () => promise };
    function ClientProvider({ children }: { children: React.ReactNode }) {
      return (
        <ChunkProvider source={() => Promise.resolve({ default: source })}>
          {children}
        </ChunkProvider>
      );
    }
    const createStream = createStreamFactory<{}, Point>({
      ChunkContent,
      ChunkLoading,
      ClientProvider,
    });
    const Stream = createStream('file:///example/index.ts');

    render(<Stream />);
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
    const createStream = createStreamFactory<{}, Point>({
      ChunkContent,
      ChunkLoading,
      ClientProvider,
    });
    const Stream = createStream('file:///example/index.ts', { precompute: { v: 1 } });

    render(<Stream />);
    expect(await screen.findByTestId('provider')).toBeTruthy();
    expect(screen.getByTestId('content').textContent).toBe('{"v":1}');
  });
});

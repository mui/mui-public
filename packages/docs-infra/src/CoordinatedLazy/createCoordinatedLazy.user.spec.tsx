/**
 * @vitest-environment jsdom
 *
 * Integration tests for `createCoordinatedLazy` - how a single self-loading
 * coordinated-lazy routes: it renders preloaded/controlled content directly, and
 * loads-then-swaps on the client from a `ChunkProvider` source. (A config
 * `source` and the server-loader / server-initial routing run on the server,
 * covered in the unit tests, since a DOM cannot run async server components.)
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { createCoordinatedLazy } from './createCoordinatedLazy';
import type { ChunkContentProps, ChunkLoadingProps, StreamSource } from './types';
import { ChunkProvider } from '../ChunkProvider';
import { createSettleGate } from '../useCoordinated/createSettleGate';

interface Point {
  v: number;
}

function ChunkContent({ data }: ChunkContentProps<{}, Point>) {
  return <div data-testid="content">{JSON.stringify(data)}</div>;
}
function ChunkLoading({ data }: ChunkLoadingProps<{}, Point>) {
  return <div data-testid="loading">loading:{JSON.stringify(data ?? null)}</div>;
}

/** A manually-resolved load so tests can observe the loading window. */
function deferredLoad() {
  let resolve!: (value: Point) => void;
  const promise = new Promise<Point>((resolveLoad) => {
    resolve = resolveLoad;
  });
  return { load: () => promise, resolve };
}

describe('createCoordinatedLazy', () => {
  it('renders preloaded content directly, with no loading placeholder (server-HTML path)', () => {
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });
    render(<Chunk preloaded={{ v: 1 }} gate={createSettleGate()} />);

    // Content is present synchronously (content mode renders it directly), and
    // the loading placeholder never appears.
    expect(screen.getByTestId('content').textContent).toBe('{"v":1}');
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('shows the loading placeholder, then swaps to content loaded via a ChunkProvider', async () => {
    const { load, resolve } = deferredLoad();
    const source: StreamSource<Point> = { mode: 'data', load };
    // A config-less chunk loads its source from a surrounding ChunkProvider on the
    // client. (A config `source` would route to the server, which jsdom can't run.)
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });
    render(
      <ChunkProvider source={() => Promise.resolve({ default: source })}>
        <Chunk gate={createSettleGate()} />
      </ChunkProvider>,
    );

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();

    await act(async () => {
      resolve({ v: 2 });
      await Promise.resolve();
    });

    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":2}');
  });

  it('shows the placeholder (no client-initial), then the full data', async () => {
    // A ChunkProvider supplies only the full load - there is no client-initial
    // channel, so the placeholder shows no data until the load resolves. (The
    // server quick-initial via `source.initial` is covered by the
    // ChunkServerLoader unit test.)
    const { load, resolve } = deferredLoad();
    const source: StreamSource<Point> = { mode: 'data', load };
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });
    render(
      <ChunkProvider source={() => Promise.resolve({ default: source })}>
        <Chunk gate={createSettleGate()} />
      </ChunkProvider>,
    );

    expect(screen.getByTestId('loading').textContent).toBe('loading:null');

    await act(async () => {
      resolve({ v: 9 });
      await Promise.resolve();
    });

    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":9}');
  });

  it('a client-loaded chunk holds its gate while loading, then settles it after the swap', async () => {
    const gate = createSettleGate();
    const { load, resolve } = deferredLoad();
    const source: StreamSource<Point> = { mode: 'data', load };
    const Chunk = createCoordinatedLazy<{}, Point>({ ChunkContent, ChunkLoading });
    render(
      <ChunkProvider source={() => Promise.resolve({ default: source })}>
        <Chunk gate={gate} />
      </ChunkProvider>,
    );

    // Registered and unsettled while the fallback is shown.
    expect(gate.isSettled()).toBe(false);

    await act(async () => {
      resolve({ v: 5 });
      await Promise.resolve();
    });

    await screen.findByTestId('content');
    await waitFor(() => expect(gate.isSettled()).toBe(true));
  });
});

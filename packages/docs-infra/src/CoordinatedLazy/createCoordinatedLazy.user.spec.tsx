/**
 * @vitest-environment jsdom
 *
 * Integration tests for `createCoordinatedLazy` - how a single self-loading
 * coordinated-lazy routes: it renders preloaded/controlled content directly, and
 * loads-then-swaps for a client source. (The server-loader / server-initial
 * routing is covered in the unit test, since a DOM cannot run async server
 * components.)
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { createCoordinatedLazy } from './createCoordinatedLazy';
import type { ChunkContentProps, ChunkLoadingProps } from './types';
import { createSettleGate } from '../useCoordinated/createSettleGate';

afterEach(cleanup);

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

  it('shows the loading placeholder, then swaps to client-loaded content', async () => {
    const { load, resolve } = deferredLoad();
    const Chunk = createCoordinatedLazy<{}, Point>({
      ChunkContent,
      ChunkLoading,
      source: { mode: 'data', load },
    });
    render(<Chunk gate={createSettleGate()} />);

    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();

    await act(async () => {
      resolve({ v: 2 });
      await Promise.resolve();
    });

    const content = await screen.findByTestId('content');
    expect(content.textContent).toBe('{"v":2}');
  });

  it('shows the initial value while loading, then the full data', async () => {
    const { load, resolve } = deferredLoad();
    const Chunk = createCoordinatedLazy<{}, Point>({
      ChunkContent,
      ChunkLoading,
      source: { mode: 'data', load, initial: () => ({ v: 0 }) },
    });
    render(<Chunk gate={createSettleGate()} />);

    // The loading placeholder paints the quick initial value first.
    expect(screen.getByTestId('loading').textContent).toBe('loading:{"v":0}');

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
    const Chunk = createCoordinatedLazy<{}, Point>({
      ChunkContent,
      ChunkLoading,
      source: { mode: 'data', load },
    });
    render(<Chunk gate={gate} />);

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

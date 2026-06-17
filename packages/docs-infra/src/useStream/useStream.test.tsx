/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useStream } from './useStream';
import type { StreamSource } from './types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveDeferred) => {
    resolve = resolveDeferred;
  });
  return { promise, resolve };
}

/** Renders the streamed chunk list and the controller's loading flag. */
function Harness({ source }: { source: StreamSource<number> }) {
  const { chunks, Controller, loading, streamComplete } = useStream({ source });
  return (
    <React.Fragment>
      <div data-testid="chunks">{chunks.join(',')}</div>
      <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
      <div data-testid="complete">{streamComplete ? 'complete' : 'streaming'}</div>
      <Controller>{null}</Controller>
    </React.Fragment>
  );
}

describe('useStream', () => {
  it('accumulates streamed chunks and settles once the stream completes', async () => {
    // Deferred gates let the test drive each chunk arrival and the end of the
    // stream, without declaring functions inside the generator's loop.
    const first = deferred<number>();
    const second = deferred<number>();
    const end = deferred<void>();
    const source: StreamSource<number> = {
      mode: 'stream',
      async *stream(chunks) {
        chunks.push(await first.promise);
        yield;
        chunks.push(await second.promise);
        yield;
        await end.promise;
      },
    };

    render(<Harness source={source} />);
    expect(screen.getByTestId('loading').textContent).toBe('loading');
    expect(screen.getByTestId('chunks').textContent).toBe('');

    first.resolve(10);
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('10'));
    expect(screen.getByTestId('loading').textContent).toBe('loading');

    second.resolve(20);
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('10,20'));

    // Still streaming until the generator returns.
    expect(screen.getByTestId('complete').textContent).toBe('streaming');

    end.resolve();
    await waitFor(() => expect(screen.getByTestId('complete').textContent).toBe('complete'));
    // With no chunk components registered, completing the stream settles it.
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('done'));
  });

  it('streams a urls-mode list and settles when the last URL has loaded', async () => {
    const source: StreamSource<string> = {
      mode: 'urls',
      loadUrls: async () => ({ chunks: [new URL('https://x/a'), new URL('https://x/b')] }),
      loadChunk: async (url) => url.pathname.slice(1),
    };

    function StringHarness() {
      const { chunks, Controller, loading } = useStream({ source });
      return (
        <React.Fragment>
          <div data-testid="chunks">{chunks.join(',')}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
          <Controller>{null}</Controller>
        </React.Fragment>
      );
    }

    render(<StringHarness />);
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('a,b'));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('done'));
  });

  it('refresh() re-streams the list and swaps the fresh list in', async () => {
    let version = 1;
    const source: StreamSource<string> = {
      mode: 'urls',
      loadUrls: async () => ({ chunks: [new URL('https://x/a')] }),
      loadChunk: async (url) => `${url.pathname.slice(1)}${version}`,
    };

    function RefreshHarness() {
      const { chunks, Controller, revalidating, refresh } = useStream({ source });
      return (
        <React.Fragment>
          <div data-testid="chunks">{chunks.join(',')}</div>
          <div data-testid="revalidating">{revalidating ? 'revalidating' : 'idle'}</div>
          <button type="button" data-testid="refresh" onClick={() => refresh()}>
            refresh
          </button>
          <Controller>{null}</Controller>
        </React.Fragment>
      );
    }

    render(<RefreshHarness />);
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('a1'));

    // Bump the version so the background re-stream yields fresh data, then refresh.
    version = 2;
    act(() => {
      screen.getByTestId('refresh').click();
    });

    // The fresh list swaps in once the re-stream completes (revalidation done).
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('a2'));
    await waitFor(() => expect(screen.getByTestId('revalidating').textContent).toBe('idle'));
  });
});

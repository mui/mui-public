/**
 * @vitest-environment jsdom
 *
 * `useChunk`'s client refresh: `refresh()` re-runs the `data`-mode loader and
 * swaps in fresh data (stale-while-revalidate — the current data stays visible
 * meanwhile), and `revalidateOnIdle` schedules one such refresh on idle after the
 * chunk loads.
 *
 * Each test builds its `config` ONCE (a stable reference) — `useChunk`'s load
 * effect is keyed on `config`, so an inline config would reload every render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`.
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useChunk } from './useChunk';
import type { CreateChunkConfig } from './types';

afterEach(cleanup);

function dataConfig(
  load: (options: undefined, signal: AbortSignal) => Promise<string>,
  extra?: Partial<CreateChunkConfig<{}, string, undefined>>,
): CreateChunkConfig<{}, string, undefined> {
  return {
    ChunkContent: () => null,
    source: { mode: 'data', load },
    ...extra,
  };
}

describe('useChunk refresh', () => {
  it('re-runs the data loader and swaps in fresh data', async () => {
    let count = 0;
    const load = vi.fn(async () => {
      count += 1;
      return `v${count}`;
    });
    const config = dataConfig(load);
    const { result } = renderHook(() => useChunk(config, {}));

    await waitFor(() => expect(result.current.data).toBe('v1'));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toBe('v2');
    expect(result.current.revalidating).toBe(false);
  });

  it('keeps the current data visible while revalidating (stale-while-revalidate)', async () => {
    let call = 0;
    let resolveSecond!: (value: string) => void;
    const load = vi.fn((): Promise<string> => {
      call += 1;
      if (call === 1) {
        return Promise.resolve('v1');
      }
      return new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });
    });
    const config = dataConfig(load);
    const { result } = renderHook(() => useChunk(config, {}));

    await waitFor(() => expect(result.current.data).toBe('v1'));

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await waitFor(() => expect(result.current.revalidating).toBe(true));
    // The previous data is still shown while the refresh is in flight.
    expect(result.current.data).toBe('v1');

    await act(async () => {
      resolveSecond('v2');
      await refreshPromise;
    });
    expect(result.current.data).toBe('v2');
    expect(result.current.revalidating).toBe(false);
  });

  it('schedules a background refresh on idle when revalidateOnIdle is set', async () => {
    // Control `requestIdleCallback` deterministically (jsdom doesn't fire it).
    const idleCallbacks: Array<() => void> = [];
    const realRequestIdle = window.requestIdleCallback;
    const realCancelIdle = window.cancelIdleCallback;
    (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (
      callback: () => void,
    ) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    };
    (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = () => {};

    try {
      let count = 0;
      const load = vi.fn(async () => {
        count += 1;
        return `v${count}`;
      });
      const config = dataConfig(load, { revalidateOnIdle: true });
      const { result } = renderHook(() => useChunk(config, {}));

      await waitFor(() => expect(result.current.data).toBe('v1'));

      // Loading the chunk scheduled exactly one idle revalidation.
      expect(idleCallbacks).toHaveLength(1);

      // Firing it runs a background refresh that swaps in fresh data.
      await act(async () => {
        idleCallbacks.forEach((callback) => callback());
      });
      await waitFor(() => expect(result.current.data).toBe('v2'));
    } finally {
      (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = realRequestIdle;
      (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = realCancelIdle;
    }
  });
});

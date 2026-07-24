/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDeferredSources } from './useDeferredSources';
import type { CodePrecompute, DeferredSources } from './types';

function code(deferredUrl: string, html: string): CodePrecompute {
  return {
    deferredUrl,
    variants: {
      Default: {
        fileName: 'Demo.tsx',
        exportName: 'default',
        html,
        language: 'tsx',
        totalLines: 20,
      },
    },
  };
}

function response(sources: DeferredSources) {
  return { ok: true, json: () => Promise.resolve(sources) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDeferredSources', () => {
  it('loads new sources when the deferred URL changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ Default: { source: '<span>old-full</span>' } }))
      .mockResolvedValueOnce(response({ Default: { source: '<span>new-full</span>' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ rawCode }) => useDeferredSources(rawCode), {
      initialProps: { rawCode: code('/old.json', '<span>old-preview</span>') },
    });

    await act(() => result.current.loadDeferredSources());
    expect(result.current.code.variants.Default.html).toContain('old-full');

    rerender({ rawCode: code('/new.json', '<span>new-preview</span>') });
    expect(result.current.deferredSources).toBeNull();
    expect(result.current.code.variants.Default.html).toContain('new-preview');

    await act(() => result.current.loadDeferredSources());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/old.json');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/new.json');
    expect(result.current.code.variants.Default.html).toContain('new-full');
  });

  it('ignores an old request that resolves after the current request', async () => {
    const oldRequest = deferred<ReturnType<typeof response>>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(response({ Default: { source: '<span>new-full</span>' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ rawCode }) => useDeferredSources(rawCode), {
      initialProps: { rawCode: code('/old.json', '<span>old-preview</span>') },
    });

    let oldLoad!: Promise<DeferredSources | null>;
    act(() => {
      oldLoad = result.current.loadDeferredSources();
    });
    rerender({ rawCode: code('/new.json', '<span>new-preview</span>') });
    await act(() => result.current.loadDeferredSources());
    expect(result.current.code.variants.Default.html).toContain('new-full');

    oldRequest.resolve(response({ Default: { source: '<span>old-full</span>' } }));
    await act(() => oldLoad);
    expect(result.current.code.variants.Default.html).toContain('new-full');
    expect(result.current.code.variants.Default.html).not.toContain('old-full');
  });
});

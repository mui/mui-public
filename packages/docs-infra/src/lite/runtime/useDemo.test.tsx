/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { useDemo } from './useDemo';
import type { CodePrecompute, ContentProps } from './types';

const DEFERRED_URL = 'https://example.test/demo.json';
const DEFERRED_PAYLOAD = {
  Default: {
    source: '<span>main-full</span>',
    extraFiles: { 'helper.ts': '<span>helper-full</span>' },
  },
};

function code(): CodePrecompute {
  return {
    deferredUrl: DEFERRED_URL,
    variants: {
      Default: {
        fileName: 'MyComponent.tsx',
        exportName: 'MyComponent',
        html: '<span>main-paint</span>',
        language: 'tsx',
        totalLines: 20,
        extraFiles: {
          'helper.ts': { language: 'ts', totalLines: 3 },
        },
      },
      Css: {
        fileName: 'MyComponent.tsx',
        exportName: 'default',
        html: '<span>css</span>',
        language: 'tsx',
        totalLines: 8,
      },
    },
  };
}

function props(precompute: CodePrecompute): ContentProps {
  return {
    name: 'My Component',
    slug: 'my-component',
    url: 'file:///project/demos/my-component/index.ts',
    components: { Default: 'default-element', Css: 'css-element' },
    code: precompute,
  };
}

function markup(node: React.ReactNode): string {
  return node == null ? '' : ReactDOMServer.renderToStaticMarkup(node);
}

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(DEFERRED_PAYLOAD),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  const values = new Map<string, string>();
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage });
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useDemo', () => {
  it('selects variants and recovers from invalid persisted variants', () => {
    const { result } = renderHook(() => useDemo(props(code())));
    expect(result.current.variants).toEqual(['Default', 'Css']);
    expect(result.current.selectedVariant).toBe('Default');
    act(() => result.current.selectVariant('Css'));
    expect(result.current.component).toBe('css-element');
    act(() => result.current.selectVariant('Missing'));
    expect(result.current.selectedVariant).toBe('Default');
  });

  it('lists files and recovers from an invalid selected extra file', () => {
    const { result } = renderHook(() => useDemo(props(code())));
    expect(result.current.files).toEqual([
      { name: 'MyComponent.tsx', slug: 'my-component:my-component.tsx' },
      { name: 'helper.ts', slug: 'my-component:helper.ts' },
    ]);
    act(() => result.current.selectFileName('helper.ts'));
    expect(result.current.selectedFileName).toBe('helper.ts');
    act(() => result.current.selectFileName('missing.ts'));
    expect(result.current.selectedFileName).toBe('MyComponent.tsx');
  });

  it('fetches deferred source markup once and resolves loading files', async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useDemo(props(code())));
    act(() => result.current.selectFileName('helper.ts'));
    expect(result.current.loading).toBe(true);
    expect(result.current.selectedFile).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(markup(result.current.selectedFile)).toContain('helper-full');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes deferred source loading for prefetching', async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useDemo(props(code())));

    await act(() => result.current.loadDeferredSources());

    expect(fetchMock).toHaveBeenCalledWith(DEFERRED_URL);
    expect(markup(result.current.selectedFile)).toContain('main-full');
  });

  it('fetches full main markup before copying truncated HTML', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch();
    const onCopied = vi.fn();
    const { result } = renderHook(() => useDemo(props(code()), { copy: { onCopied } }));

    await act(async () => result.current.copy());

    expect(writeText).toHaveBeenCalledWith('main-full');
    expect(onCopied).toHaveBeenCalledOnce();
  });

  it('exposes deferred source failures and retries them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(DEFERRED_PAYLOAD) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDemo(props(code())));
    act(() => result.current.selectFileName('helper.ts'));

    await waitFor(() => expect(result.current.deferredSourcesError?.message).toBe('HTTP 503'));
    expect(result.current.loading).toBe(true);

    await act(() => result.current.loadDeferredSources());

    expect(result.current.deferredSourcesError).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(markup(result.current.selectedFile)).toContain('helper-full');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not copy truncated source when deferred source loading fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const onCopied = vi.fn();
    const { result } = renderHook(() => useDemo(props(code()), { copy: { onCopied } }));

    await act(async () => result.current.copy());

    expect(writeText).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
    expect(result.current.deferredSourcesError?.message).toBe('HTTP 503');
  });

  it('applies a matching hash to variant, file, and expansion state', async () => {
    stubFetch();
    const { result } = renderHook(() => useDemo(props(code())));
    act(() => {
      window.location.hash = '#my-component:helper.ts';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(result.current.expanded).toBe(true));
    expect(result.current.selectedVariant).toBe('Default');
    expect(result.current.selectedFileName).toBe('helper.ts');
  });
});

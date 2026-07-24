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
        exportName: 'default',
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

function props(): ContentProps {
  return {
    name: 'My Component',
    slug: 'my-component',
    url: 'file:///project/demos/my-component/index.ts',
    components: { Default: 'default-el', Css: 'css-el' },
    code: code(),
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
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo user behavior', () => {
  it('switches variants and restores the main file selection', () => {
    const { result } = renderHook(() => useDemo(props()));
    act(() => result.current.selectFileName('helper.ts'));
    act(() => result.current.selectVariant('Css'));

    expect(result.current.selectedVariant).toBe('Css');
    expect(result.current.selectedFileName).toBe('MyComponent.tsx');
    expect(result.current.component).toBe('css-el');
  });

  it('loads a deferred extra file when selected', async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useDemo(props()));
    act(() => result.current.selectFileName('helper.ts'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(markup(result.current.selectedFile)).toContain('helper-full');
    expect(fetchMock).toHaveBeenCalledWith(DEFERRED_URL);
  });

  it('loads full sources when expanded', async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useDemo(props()));
    act(() => result.current.expand());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(DEFERRED_URL));
    await waitFor(() => expect(markup(result.current.selectedFile)).toContain('main-full'));
  });

  it('copies a deferred extra file', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch();
    const { result } = renderHook(() => useDemo(props()));
    act(() => result.current.selectFileName('helper.ts'));

    await act(async () => result.current.copy());

    expect(writeText).toHaveBeenCalledWith('helper-full');
  });

  it('navigates to a matching file hash', async () => {
    stubFetch();
    const { result } = renderHook(() => useDemo(props()));
    act(() => {
      window.location.hash = '#my-component:helper.ts';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(result.current.expanded).toBe(true));
    expect(result.current.selectedFileName).toBe('helper.ts');
  });
});

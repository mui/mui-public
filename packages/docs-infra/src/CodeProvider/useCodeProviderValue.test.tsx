/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCodeProviderValue } from './useCodeProviderValue';
import type { CodeProviderBaseProps, CodeProviderHeavyAccessors } from './useCodeProviderValue';
import type { ParseSource } from '../CodeHighlighter/types';

const props = {} as CodeProviderBaseProps;

/** The hook only forwards these (never calls them in these tests), so stubs suffice. */
const heavy = {
  loadCodeFallbackLoader: vi.fn(),
  loadIsomorphicCodeVariantLoader: vi.fn(),
  computeHastDeltasLoader: vi.fn(),
  codeEditorLoader: vi.fn(),
  transformEngineLoader: vi.fn(),
  defaultSourceEnhancers: [],
} as unknown as CodeProviderHeavyAccessors;

describe('useCodeProviderValue source-parser initialization', () => {
  it('publishes the parser only after a consumer requests it', async () => {
    const parseSourceFn = vi.fn() as unknown as ParseSource;
    const createSourceParser = vi.fn(() => Promise.resolve(parseSourceFn));

    const { result } = renderHook(() => useCodeProviderValue(props, heavy, createSourceParser));

    expect(createSourceParser).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.loadSourceParser?.();
    });
    expect(result.current.parseSource).toBe(parseSourceFn);
    expect(createSourceParser).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load and leaves the parser unavailable', async () => {
    const createSourceParser = vi.fn(() => Promise.reject(new Error('chunk load failed')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useCodeProviderValue(props, heavy, createSourceParser));

    await act(async () => {
      await expect(result.current.loadSourceParser?.()).rejects.toThrow('chunk load failed');
    });
    expect(createSourceParser).toHaveBeenCalledTimes(1);
    expect(result.current.parseSource).toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});

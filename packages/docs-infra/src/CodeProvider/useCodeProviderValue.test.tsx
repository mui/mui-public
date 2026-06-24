/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCodeProviderValue } from './useCodeProviderValue';
import type { CodeProviderBaseProps, CodeProviderHeavyAccessors } from './useCodeProviderValue';
import type { ParseSource } from '../CodeHighlighter/types';

const props = {} as CodeProviderBaseProps;

/** The hook only forwards these (never calls them in these tests), so stubs suffice. */
const heavy = {
  loadCodeFallbackLoader: vi.fn(),
  loadIsomorphicCodeVariantLoader: vi.fn(),
  computeHastDeltasLoader: vi.fn(),
  editingEngineLoader: vi.fn(),
  transformEngineLoader: vi.fn(),
  defaultSourceEnhancers: [],
} as unknown as CodeProviderHeavyAccessors;

describe('useCodeProviderValue source-parser initialization', () => {
  it('publishes the parser once its promise resolves', async () => {
    const parseSourceFn = vi.fn() as unknown as ParseSource;
    const createSourceParser = vi.fn(() => Promise.resolve(parseSourceFn));

    const { result } = renderHook(() => useCodeProviderValue(props, heavy, createSourceParser));

    await waitFor(() => expect(result.current.parseSource).toBe(parseSourceFn));
    expect(createSourceParser).toHaveBeenCalledTimes(1);
  });

  it('retries and self-heals after a transient parser load failure (no reload needed)', async () => {
    const parseSourceFn = vi.fn() as unknown as ParseSource;
    let attempt = 0;
    const createSourceParser = vi.fn(() => {
      attempt += 1;
      // The first load fails (a transient chunk/WASM fetch blip); the retry succeeds.
      return attempt === 1
        ? Promise.reject(new Error('chunk load failed'))
        : Promise.resolve(parseSourceFn);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useCodeProviderValue(props, heavy, createSourceParser));

    // A rejected parser would otherwise leave `parseSource` undefined forever (code
    // stuck un-highlighted until a reload); the retry recreates it and recovers.
    await waitFor(() => expect(result.current.parseSource).toBe(parseSourceFn), { timeout: 3000 });
    expect(createSourceParser.mock.calls.length).toBeGreaterThanOrEqual(2);

    consoleError.mockRestore();
  });

  it('stops retrying after the bounded number of attempts (no infinite loop)', async () => {
    const createSourceParser = vi.fn(() => Promise.reject(new Error('permanent failure')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useCodeProviderValue(props, heavy, createSourceParser));

    // One initial attempt + the bounded retries, then it gives up (no reload-loop).
    await waitFor(() => expect(createSourceParser).toHaveBeenCalledTimes(4), { timeout: 5000 });
    // Settle past any further backoff window and confirm no extra attempt fired.
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(createSourceParser).toHaveBeenCalledTimes(4);
    expect(result.current.parseSource).toBeUndefined();

    consoleError.mockRestore();
  });
});

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVariantSelection } from './useVariantSelection';

let hash: string | null = null;
const setHash = vi.fn((next: string | null) => {
  hash = next;
});

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [hash, setHash],
}));

const effectiveCode = {
  Default: { source: 'const value = 1;', fileName: 'demo.js' },
  Alternative: { source: 'const value = 2;', fileName: 'demo.js' },
  Third: { source: 'const value = 3;', fileName: 'demo.js' },
};

beforeEach(() => {
  hash = null;
  setHash.mockClear();
  const store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    },
    configurable: true,
  });
});

describe('useVariantSelection', () => {
  it('selects the first variant by default', () => {
    const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

    expect(result.current.variantKeys).toEqual(['Default', 'Alternative', 'Third']);
    expect(result.current.selectedVariantKey).toBe('Default');
    expect(result.current.readyVariantKey).toBe('Default');
    expect(result.current.selectedVariant).toBe(effectiveCode.Default);
  });

  it('uses initialVariant when no higher-precedence source exists', () => {
    const { result } = renderHook(() =>
      useVariantSelection({ effectiveCode, initialVariant: 'Alternative' }),
    );

    expect(result.current.selectedVariantKey).toBe('Alternative');
    expect(result.current.readyVariantKey).toBe('Alternative');
  });

  it('gives storage precedence over initialVariant', () => {
    window.localStorage.setItem('_docs_variant_pref:Alternative:Default:Third', 'Third');

    const { result } = renderHook(() =>
      useVariantSelection({ effectiveCode, initialVariant: 'Alternative' }),
    );

    expect(result.current.selectedVariantKey).toBe('Third');
  });

  it('gives a relevant URL hash precedence over storage', () => {
    hash = 'demo:alternative:demo.js';
    window.localStorage.setItem('_docs_variant_pref:Alternative:Default:Third', 'Third');

    const { result } = renderHook(() =>
      useVariantSelection({ effectiveCode, initialVariant: 'Default', mainSlug: 'demo' }),
    );

    expect(result.current.selectedVariantKey).toBe('Alternative');
  });

  it('applies a warm selection immediately and persists it', () => {
    const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

    act(() => {
      result.current.selectVariant('Alternative');
    });

    expect(result.current.selectedVariantKey).toBe('Alternative');
    expect(result.current.readyVariantKey).toBe('Alternative');
    expect(result.current.readyVariant).toBe(effectiveCode.Alternative);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      '_docs_variant_pref:Alternative:Default:Third',
      'Alternative',
    );
  });

  it('clears a relevant hash before persisting a user selection', () => {
    hash = 'demo:demo.js';
    const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

    act(() => {
      result.current.selectVariant('Third');
    });

    expect(setHash).toHaveBeenCalledWith(null);
    expect(result.current.selectedVariantKey).toBe('Third');
  });

  it('retains the old rendered variant while highlighting is cold', () => {
    const { result, rerender } = renderHook(
      ({ deferHighlight }: { deferHighlight: boolean }) =>
        useVariantSelection({ effectiveCode, deferHighlight }),
      { initialProps: { deferHighlight: true } },
    );

    act(() => {
      result.current.selectVariant('Alternative');
    });

    expect(result.current.selectedVariantKey).toBe('Alternative');
    expect(result.current.readyVariantKey).toBe('Default');
    expect(result.current.readyVariant).toBe(effectiveCode.Default);

    rerender({ deferHighlight: false });

    expect(result.current.readyVariantKey).toBe('Alternative');
    expect(result.current.readyVariant).toBe(effectiveCode.Alternative);
  });

  it('commits only the latest rapid selection when readiness returns', () => {
    const { result, rerender } = renderHook(
      ({ deferHighlight }: { deferHighlight: boolean }) =>
        useVariantSelection({ effectiveCode, deferHighlight }),
      { initialProps: { deferHighlight: true } },
    );

    act(() => {
      result.current.selectVariant('Alternative');
      result.current.selectVariant('Third');
    });

    expect(result.current.selectedVariantKey).toBe('Third');
    expect(result.current.readyVariantKey).toBe('Default');

    rerender({ deferHighlight: false });

    expect(result.current.readyVariantKey).toBe('Third');
  });

  it('keeps old content during a cold stored-preference bootstrap', () => {
    window.localStorage.setItem('_docs_variant_pref:Alternative:Default:Third', 'Alternative');

    const { result, rerender } = renderHook(
      ({ deferHighlight }: { deferHighlight: boolean }) =>
        useVariantSelection({ effectiveCode, initialVariant: 'Default', deferHighlight }),
      { initialProps: { deferHighlight: true } },
    );

    expect(result.current.selectedVariantKey).toBe('Alternative');
    expect(result.current.readyVariantKey).toBe('Default');

    rerender({ deferHighlight: false });

    expect(result.current.readyVariantKey).toBe('Alternative');
  });

  it('uses variantType as the storage bucket', () => {
    renderHook(() => useVariantSelection({ effectiveCode, variantType: 'syntax' }));

    expect(window.localStorage.getItem).toHaveBeenCalledWith('_docs_variant_pref:syntax');
  });

  it('ignores invalid selections', () => {
    const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

    act(() => {
      result.current.selectVariant('Missing');
    });

    expect(result.current.selectedVariantKey).toBe('Default');
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
  });
});

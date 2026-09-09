/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { preloadTransformEngine, useTransformManagement } from './useTransformManagement';
import { createTransformedFiles } from './TransformEngine';
import { getApplicableTransforms, getAvailableTransforms } from './useCodeUtils';

vi.mock('./useCodeUtils', () => {
  const available = vi.fn(() => [] as string[]);
  return {
    getAvailableTransforms: available,
    getApplicableTransforms: vi.fn((...args: unknown[]) =>
      (available as (...innerArgs: unknown[]) => string[])(...args),
    ),
  };
});

vi.mock('./TransformEngine', () => ({
  createTransformedFiles: vi.fn(),
}));

const effectiveCode = {
  Default: { source: 'const value = 1;', fileName: 'demo.ts' },
};
const selectedVariant = effectiveCode.Default;

beforeAll(async () => {
  await preloadTransformEngine();
});

afterEach(() => {
  vi.clearAllMocks();
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

function renderTransformManagement(initialTransform?: string) {
  return renderHook(() =>
    useTransformManagement({
      effectiveCode,
      selectedVariantKey: 'Default',
      selectedVariant,
      initialTransform,
    }),
  );
}

describe('useTransformManagement', () => {
  it('uses the context transform list when supplied', () => {
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['js']);

    const { result } = renderHook(() =>
      useTransformManagement({
        context: { availableTransforms: ['js'] },
        effectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant,
      }),
    );

    expect(result.current.availableTransforms).toEqual(['js']);
    expect(getAvailableTransforms).not.toHaveBeenCalled();
  });

  it('gives a stored preference precedence over initialTransform', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['ts', 'js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['ts', 'js']);
    window.localStorage.setItem('_docs_transform_pref:js:ts', 'js');

    const { result } = renderTransformManagement('ts');

    expect(result.current.selectedTransform).toBe('js');
  });

  it('uses initialTransform when no preference has been stored', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['ts', 'js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['ts', 'js']);

    const { result } = renderTransformManagement('ts');

    expect(result.current.selectedTransform).toBe('ts');
  });

  it('applies a warm transform selection immediately', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['ts', 'js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['ts', 'js']);
    (createTransformedFiles as ReturnType<typeof vi.fn>).mockImplementation(
      (_variant, transform) => ({ transform }),
    );
    const { result } = renderTransformManagement('ts');

    act(() => {
      result.current.selectTransform('js');
    });

    expect(result.current.selectedTransform).toBe('js');
    expect(result.current.transformedFiles).toEqual({ transform: 'js' });
    expect(window.localStorage.setItem).toHaveBeenCalledWith('_docs_transform_pref:js:ts', 'js');
  });

  it('normalizes an invalid selection to the original source', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['ts', 'js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['ts', 'js']);
    (createTransformedFiles as ReturnType<typeof vi.fn>).mockImplementation(
      (_variant, transform) => (transform ? { transform } : undefined),
    );
    const { result } = renderTransformManagement('ts');

    act(() => {
      result.current.selectTransform('missing');
    });

    expect(result.current.selectedTransform).toBe(null);
    expect(result.current.transformedFiles).toBeUndefined();
    expect(window.localStorage.setItem).toHaveBeenCalledWith('_docs_transform_pref:js:ts', '');
  });

  it('supports externally controlled transform selection without reading storage', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['ts', 'js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValueOnce(['ts', 'js']);
    window.localStorage.setItem('_docs_transform_pref:js:ts', 'js');
    const onSelectedTransformChange = vi.fn();

    const { result } = renderHook(() =>
      useTransformManagement({
        effectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant,
        selectedTransform: null,
        onSelectedTransformChange,
      }),
    );

    expect(result.current.selectedTransform).toBe(null);
    act(() => {
      result.current.selectTransform('js');
    });
    expect(onSelectedTransformChange).toHaveBeenCalledWith('js');
    expect(result.current.selectedTransform).toBe(null);
  });

  it('resolves and persists rename-only transforms', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getApplicableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['js']);
    (createTransformedFiles as ReturnType<typeof vi.fn>).mockReturnValue({
      files: [{ name: 'demo.js', originalName: 'demo.ts', source: 'const value = 1;' }],
      filenameMap: { 'demo.ts': 'demo.js' },
    });
    window.localStorage.setItem('_docs_transform_pref:js', 'js');

    const { result } = renderTransformManagement();

    expect(result.current.availableTransforms).toEqual([]);
    expect(result.current.selectedTransform).toBe('js');
    expect(result.current.transformedFiles?.filenameMap['demo.ts']).toBe('demo.js');
  });

  it('keeps edited source untransformed until the pristine manifest returns', () => {
    (getAvailableTransforms as ReturnType<typeof vi.fn>).mockReturnValue(['js']);
    (getApplicableTransforms as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    (createTransformedFiles as ReturnType<typeof vi.fn>).mockReturnValue({ transform: 'js' });

    const { result } = renderHook(() =>
      useTransformManagement({
        context: { availableTransforms: ['js'] },
        effectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant,
        initialTransform: 'js',
      }),
    );

    expect(result.current.selectedTransform).toBe('js');
    expect(result.current.transformedFiles).toBeUndefined();
  });
});

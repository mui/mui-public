/**
 * @vitest-environment jsdom
 *
 * Cold-cache behavior for the lazily-loaded transform engine: a block that has
 * transforms resolves `createTransformedFiles` via the `transformEngineLoader`
 * accessor on first render, while a block with no transforms never loads the
 * chunk. The warm path (engine already cached) is covered in
 * `useTransformManagement.test.ts`; here we start cold each test.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import {
  useTransformManagement,
  resetTransformEngineCache,
  preloadTransformEngine,
} from './useTransformManagement';
import { createTransformedFiles } from './TransformEngine';
import type { CreateTransformedFiles } from './TransformEngine';
import { CodeContext } from '../CodeProvider/CodeContext';
import type { CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import type { VariantCode } from '../CodeHighlighter/types';

beforeEach(() => {
  resetTransformEngineCache();
});

afterEach(() => {
  cleanup();
});

/** Renders the hook under a `CodeContext` supplying the given engine loader. */
function renderWithLoader(
  selectedVariant: VariantCode,
  transformEngineLoader: CodeContextValue['transformEngineLoader'],
  initialTransform?: string,
) {
  return renderHook(
    () =>
      useTransformManagement({
        effectiveCode: { Default: selectedVariant },
        selectedVariantKey: 'Default',
        selectedVariant,
        initialTransform,
        transformLayoutShift: 'all',
        expanded: false,
      }),
    {
      wrapper: ({ children }) => (
        <CodeContext.Provider value={{ transformEngineLoader }}>{children}</CodeContext.Provider>
      ),
    },
  );
}

const variantWithTransform = (): VariantCode =>
  ({
    source: 'const x = 1;',
    fileName: 'test.js',
    transforms: { ts: { delta: { 0: ['const x: number = 1;'] }, fileName: 'test.ts' } },
  }) as VariantCode;

describe('useTransformManagement lazy transform engine (cold cache)', () => {
  it('loads the transform engine via the accessor when the variant has transforms', async () => {
    const transformEngineLoader = vi.fn(
      async (): Promise<CreateTransformedFiles> => createTransformedFiles,
    );
    const variant: VariantCode = {
      source: 'const x = 1;',
      fileName: 'test.js',
      transforms: { ts: { delta: { 0: ['const x: number = 1;'] }, fileName: 'test.ts' } },
    } as VariantCode;

    renderWithLoader(variant, transformEngineLoader);

    // The block has a transform, so the engine is resolved on mount (cold).
    await waitFor(() => expect(transformEngineLoader).toHaveBeenCalledTimes(1));
  });

  it('never loads the transform engine for a block with no transforms', async () => {
    const transformEngineLoader = vi.fn(
      async (): Promise<CreateTransformedFiles> => createTransformedFiles,
    );
    const variant: VariantCode = { source: 'const x = 1;', fileName: 'test.js' } as VariantCode;

    renderWithLoader(variant, transformEngineLoader);

    // Give any stray effect a chance to fire, then assert the loader stayed cold.
    await Promise.resolve();
    expect(transformEngineLoader).not.toHaveBeenCalled();
  });

  it('with a pre-selected transform on a cold cache, transformedFiles resolves once the engine loads', async () => {
    const transformEngineLoader = vi.fn(
      async (): Promise<CreateTransformedFiles> => createTransformedFiles,
    );

    const { result } = renderWithLoader(variantWithTransform(), transformEngineLoader, 'ts');

    // Cold first render: the applier isn't resolved yet, so the memo holds off.
    expect(result.current.transformedFiles).toBeUndefined();

    // After the engine resolves it re-renders with the transformed files.
    await waitFor(() => expect(result.current.transformedFiles).toBeDefined());
    expect(result.current.transformedFiles?.filenameMap['test.js']).toBe('test.ts');
  });

  it('a primed cache (speculative preload) yields transformedFiles on the FIRST render — no flash', async () => {
    // Mirrors what `useSpeculativeUseCodePreload` does: prime the shared cache
    // before the transform-bearing block first renders.
    await preloadTransformEngine();

    const transformEngineLoader = vi.fn(
      async (): Promise<CreateTransformedFiles> => createTransformedFiles,
    );
    const { result } = renderWithLoader(variantWithTransform(), transformEngineLoader, 'ts');

    // Warm: the applier is read synchronously from the cache on the first render,
    // so the transformed files are present immediately (no un-transformed frame).
    expect(result.current.transformedFiles?.filenameMap['test.js']).toBe('test.ts');
  });
});

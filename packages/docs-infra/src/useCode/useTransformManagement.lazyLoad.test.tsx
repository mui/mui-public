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
import { useTransformManagement, resetTransformEngineCache } from './useTransformManagement';
import { createTransformedFiles, type CreateTransformedFiles } from './TransformEngine';
import { CodeContext, type CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
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
) {
  return renderHook(
    () =>
      useTransformManagement({
        effectiveCode: { Default: selectedVariant },
        selectedVariantKey: 'Default',
        selectedVariant,
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
});

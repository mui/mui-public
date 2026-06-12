/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative preload: when CodeHighlighterClient
 * can cheaply tell (from props/manifest) that it will need a heavy function, it
 * calls the matching CodeContext loader accessor early (on mount), so the work
 * is already in flight before the content mounts and awaits it. Calling the
 * accessor is instant under an eager CodeProvider and kicks the deduped fetch
 * under CodeProviderLazy; either way the hook is uniform. The signals are
 * accurate, so a precomputed/code-free block preloads nothing.
 */
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, cleanup } from '@testing-library/react';
import { CodeContext, type CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import { useSpeculativeCodePreload } from './useSpeculativeCodePreload';

afterEach(cleanup);

function makeLoaders() {
  return {
    loadIsomorphicCodeVariantLoader: vi.fn(async () => async () => ({}) as never),
    loadCodeFallbackLoader: vi.fn(async () => async () => ({ code: {} }) as never),
    computeHastDeltasLoader: vi.fn(async () => async () => ({}) as never),
  };
}

function setup(
  props: { needsData: boolean; hasTransforms: boolean },
  loaders: Partial<CodeContextValue>,
) {
  function Speculative() {
    useSpeculativeCodePreload(props);
    return null;
  }
  render(
    <CodeContext.Provider value={loaders}>
      <Speculative />
    </CodeContext.Provider>,
  );
}

describe('useSpeculativeCodePreload', () => {
  it('preloads the fallback + variant loaders when the block will fetch data', () => {
    const loaders = makeLoaders();
    setup({ needsData: true, hasTransforms: false }, loaders);
    expect(loaders.loadCodeFallbackLoader).toHaveBeenCalled();
    expect(loaders.loadIsomorphicCodeVariantLoader).toHaveBeenCalled();
    expect(loaders.computeHastDeltasLoader).not.toHaveBeenCalled();
  });

  it('preloads the deltas computer when transforms will be computed client-side', () => {
    const loaders = makeLoaders();
    setup({ needsData: false, hasTransforms: true }, loaders);
    expect(loaders.computeHastDeltasLoader).toHaveBeenCalled();
    expect(loaders.loadCodeFallbackLoader).not.toHaveBeenCalled();
    expect(loaders.loadIsomorphicCodeVariantLoader).not.toHaveBeenCalled();
  });

  it('preloads nothing for a precomputed, transform-free block', () => {
    const loaders = makeLoaders();
    setup({ needsData: false, hasTransforms: false }, loaders);
    expect(loaders.loadIsomorphicCodeVariantLoader).not.toHaveBeenCalled();
    expect(loaders.loadCodeFallbackLoader).not.toHaveBeenCalled();
    expect(loaders.computeHastDeltasLoader).not.toHaveBeenCalled();
  });

  it('does nothing (no throw) when no CodeProvider is present', () => {
    function Speculative() {
      useSpeculativeCodePreload({ needsData: true, hasTransforms: true });
      return null;
    }
    expect(() => render(<Speculative />)).not.toThrow();
  });
});

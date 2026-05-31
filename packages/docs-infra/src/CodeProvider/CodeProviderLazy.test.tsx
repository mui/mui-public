/**
 * @vitest-environment jsdom
 *
 * Contract for CodeProviderLazy: same accessor interface as the eager
 * CodeProvider, but each heavy-function accessor is backed by a dynamic
 * `import()` (kept out of the initial bundle) and deduped per page via
 * PreloadProvider - so a speculative preload and the eventual consumer share one
 * fetch. The small synchronous parsers stay eager.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, cleanup } from '@testing-library/react';
import { CodeProviderLazy } from './CodeProviderLazy';
import { useCodeContext, type CodeContext as CodeContextValue } from './CodeContext';

afterEach(cleanup);

/** Renders a probe under `wrapper` and returns the captured CodeContext value. */
function renderUnder(wrapper: (children: React.ReactNode) => React.ReactElement) {
  const probeRef: { current: CodeContextValue | undefined } = { current: undefined };
  function Probe() {
    const ctx = useCodeContext();
    React.useEffect(() => {
      probeRef.current = ctx;
    }, [ctx]);
    return null;
  }
  render(wrapper(<Probe />));
  return probeRef;
}

describe('CodeProviderLazy', () => {
  it('exposes the heavy functions as lazy loader accessors that resolve to the underlying functions', async () => {
    const ctx = renderUnder((children) => <CodeProviderLazy>{children}</CodeProviderLazy>).current!;
    expect(typeof ctx.loadIsomorphicCodeVariantLoader).toBe('function');
    await expect(ctx.loadIsomorphicCodeVariantLoader!()).resolves.toBeTypeOf('function');
    await expect(ctx.loadCodeFallbackLoader!()).resolves.toBeTypeOf('function');
    await expect(ctx.computeHastDeltasLoader!()).resolves.toBeTypeOf('function');
    // The default emphasis enhancer stays eager (used on the sync editing path),
    // so it's provided directly, not lazily, even by the lazy provider.
    expect(ctx.sourceEnhancers).toBeInstanceOf(Array);
  });

  it('dedupes the loader promise via its built-in PreloadProvider (one fetch per page)', () => {
    // No external PreloadProvider needed - CodeProviderLazy renders its own.
    const ctx = renderUnder((children) => <CodeProviderLazy>{children}</CodeProviderLazy>).current!;
    const accessor = ctx.loadIsomorphicCodeVariantLoader!;
    // Same cached promise: a speculative preload and the real consumer share it.
    expect(accessor()).toBe(accessor());
  });

  it('keeps the synchronous parsers eager (direct functions, not accessors)', () => {
    const ctx = renderUnder((children) => <CodeProviderLazy>{children}</CodeProviderLazy>).current!;
    expect(typeof ctx.parseCode).toBe('function');
    expect(typeof ctx.parseControlledCode).toBe('function');
  });
});

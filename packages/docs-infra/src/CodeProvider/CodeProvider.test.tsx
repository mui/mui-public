/**
 * @vitest-environment jsdom
 *
 * Contract for the eager CodeProvider: code-processing accessors resolve to
 * bundled functions, while the textarea editor remains lazy for read-only pages.
 * The small synchronous parsers stay eager direct functions.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CodeProvider } from './CodeProvider';
import { useCodeContext } from './CodeContext';
import type { CodeContext as CodeContextValue } from './CodeContext';

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

describe('CodeProvider (eager)', () => {
  it('exposes the heavy functions as loader accessors, with the default enhancers bundled directly', () => {
    const ctx = renderUnder((children) => <CodeProvider>{children}</CodeProvider>).current!;
    expect(typeof ctx.loadIsomorphicCodeVariantLoader).toBe('function');
    expect(typeof ctx.loadCodeFallbackLoader).toBe('function');
    expect(typeof ctx.computeHastDeltasLoader).toBe('function');
    // Eager: the default enhancer is bundled, so it's provided directly (no loader).
    expect(ctx.sourceEnhancers).toBeInstanceOf(Array);
  });

  it('resolves each loader accessor to the bundled function', async () => {
    const ctx = renderUnder((children) => <CodeProvider>{children}</CodeProvider>).current!;
    await expect(ctx.loadIsomorphicCodeVariantLoader!()).resolves.toBeTypeOf('function');
    await expect(ctx.loadCodeFallbackLoader!()).resolves.toBeTypeOf('function');
    await expect(ctx.computeHastDeltasLoader!()).resolves.toBeTypeOf('function');
    const editorModule = await ctx.codeEditorLoader!();
    expect(editorModule.CodeEditor).toBeTypeOf('function');
    // The transform applier (jsondiffpatch path) resolves to `createTransformedFiles`.
    await expect(ctx.transformEngineLoader!()).resolves.toBeTypeOf('function');
  });

  it('keeps the synchronous parsers eager (direct functions, not accessors)', () => {
    const ctx = renderUnder((children) => <CodeProvider>{children}</CodeProvider>).current!;
    expect(typeof ctx.parseCode).toBe('function');
    expect(typeof ctx.parseControlledCode).toBe('function');
  });
});

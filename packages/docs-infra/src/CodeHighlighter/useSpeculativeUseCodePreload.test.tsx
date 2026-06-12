/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative `useCode`-chunk preload: when a block
 * declares transforms (surfaced as `hasTransforms`), CodeHighlighterClient calls
 * the CodeContext `transformEngineLoader` accessor on mount so the transform
 * applier (the `jsondiffpatch` chunk) is in flight before the reader switches a
 * transform. A block without transforms never prefetches it.
 */
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, cleanup } from '@testing-library/react';
import { CodeContext, type CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import { useSpeculativeUseCodePreload } from './useSpeculativeUseCodePreload';

afterEach(cleanup);

function setup(props: { hasTransforms: boolean }, loaders: Partial<CodeContextValue>) {
  function Speculative() {
    useSpeculativeUseCodePreload(props);
    return null;
  }
  render(
    <CodeContext.Provider value={loaders}>
      <Speculative />
    </CodeContext.Provider>,
  );
}

describe('useSpeculativeUseCodePreload', () => {
  it('preloads the transform engine when the block has transforms', () => {
    const transformEngineLoader = vi.fn(async () => (() => undefined) as never);
    setup({ hasTransforms: true }, { transformEngineLoader });
    expect(transformEngineLoader).toHaveBeenCalled();
  });

  it('preloads nothing for a block with no transforms', () => {
    const transformEngineLoader = vi.fn(async () => (() => undefined) as never);
    setup({ hasTransforms: false }, { transformEngineLoader });
    expect(transformEngineLoader).not.toHaveBeenCalled();
  });

  it('does nothing (no throw) when no CodeProvider is present', () => {
    function Speculative() {
      useSpeculativeUseCodePreload({ hasTransforms: true });
      return null;
    }
    expect(() => render(<Speculative />)).not.toThrow();
  });
});

/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative editing preload: when a block will
 * be editable (a CodeControllerContext with `setCode` is in scope, surfaced as
 * `enabled`), CodeHighlighterClient calls the CodeContext `editableEngineLoader`
 * accessor on mount so the editing engine is in flight before the user engages.
 * Calling the accessor is instant under an eager CodeProvider and kicks the
 * deduped fetch under CodeProviderLazy. A read-only block sets `enabled = false`,
 * so the engine is never prefetched where it won't be used.
 */
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, cleanup } from '@testing-library/react';
import { CodeContext, type CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import { useSpeculativeEditingPreload } from './useSpeculativeEditingPreload';

afterEach(cleanup);

function setup(
  props: { enabled: boolean; editActivation?: 'eager' | 'interaction' },
  loaders: Partial<CodeContextValue>,
) {
  function Speculative() {
    useSpeculativeEditingPreload(props);
    return null;
  }
  render(
    <CodeContext.Provider value={loaders}>
      <Speculative />
    </CodeContext.Provider>,
  );
}

describe('useSpeculativeEditingPreload', () => {
  it('preloads the editing engine when the block will be editable', () => {
    const editableEngineLoader = vi.fn(async () => (() => ({})) as never);
    setup({ enabled: true }, { editableEngineLoader });
    expect(editableEngineLoader).toHaveBeenCalled();
  });

  it('preloads nothing for a read-only block', () => {
    const editableEngineLoader = vi.fn(async () => (() => ({})) as never);
    setup({ enabled: false }, { editableEngineLoader });
    expect(editableEngineLoader).not.toHaveBeenCalled();
  });

  it("preloads nothing when editActivation is 'interaction' (the engine loads on engage)", () => {
    const editableEngineLoader = vi.fn(async () => (() => ({})) as never);
    setup({ enabled: true, editActivation: 'interaction' }, { editableEngineLoader });
    expect(editableEngineLoader).not.toHaveBeenCalled();
  });

  it("preloads when editActivation is 'eager'", () => {
    const editableEngineLoader = vi.fn(async () => (() => ({})) as never);
    setup({ enabled: true, editActivation: 'eager' }, { editableEngineLoader });
    expect(editableEngineLoader).toHaveBeenCalled();
  });

  it('does nothing (no throw) when no CodeProvider is present', () => {
    function Speculative() {
      useSpeculativeEditingPreload({ enabled: true });
      return null;
    }
    expect(() => render(<Speculative />)).not.toThrow();
  });
});

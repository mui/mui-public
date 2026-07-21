/**
 * @vitest-environment jsdom
 *
 * Contract for the first-render speculative editing preload: when a block will
 * be editable (`enabled`), CodeHighlighterClient warms the textarea editor (and
 * grammars + worker) so they're in flight before the user edits. Timing follows
 * `editActivation`: `'eager'` warms on mount; `'interaction'` warms only once the
 * block is `activated` (engaged). A read-only block (`enabled = false`) warms
 * nothing.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CodeContext } from '../CodeProvider/CodeContext';
import type { CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import { useSpeculativeEditingPreload } from './useSpeculativeEditingPreload';

function setup(
  props: { enabled: boolean; editActivation?: 'eager' | 'interaction'; activated?: boolean },
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
  it('warms the textarea editor when the block will be editable (eager)', () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    setup({ enabled: true }, { codeEditorLoader });
    expect(codeEditorLoader).toHaveBeenCalled();
  });

  it('warms nothing for a read-only block', () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    setup({ enabled: false }, { codeEditorLoader });
    expect(codeEditorLoader).not.toHaveBeenCalled();
  });

  it("waits for activation when editActivation is 'interaction'", () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    setup({ enabled: true, editActivation: 'interaction', activated: false }, { codeEditorLoader });
    expect(codeEditorLoader).not.toHaveBeenCalled();
  });

  it("warms once an 'interaction' block is activated", () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    setup({ enabled: true, editActivation: 'interaction', activated: true }, { codeEditorLoader });
    expect(codeEditorLoader).toHaveBeenCalled();
  });

  it("warms on mount when editActivation is 'eager'", () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    setup({ enabled: true, editActivation: 'eager' }, { codeEditorLoader });
    expect(codeEditorLoader).toHaveBeenCalled();
  });

  it('warms the worker with the block grammar scopes once editable', () => {
    const codeEditorLoader = vi.fn(async () => ({}) as never);
    const ensureParseSourceWorker = vi.fn();
    setup({ enabled: true, scopes: ['source.tsx'] } as never, {
      codeEditorLoader,
      ensureParseSourceWorker,
    });
    expect(ensureParseSourceWorker).toHaveBeenCalledWith(['source.tsx']);
  });

  it('does nothing (no throw) when no CodeProvider is present', () => {
    function Speculative() {
      useSpeculativeEditingPreload({ enabled: true });
      return null;
    }
    expect(() => render(<Speculative />)).not.toThrow();
  });
});

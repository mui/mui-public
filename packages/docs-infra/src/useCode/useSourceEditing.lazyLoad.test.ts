/**
 * @vitest-environment jsdom
 *
 * Cold-cache behavior for the lazily-loaded source-editing engine. The shared
 * `useSourceEditing.test.ts` warms the engine in `beforeAll`; here we reset it so
 * `setSource`'s cold first-edit deferral (and the edit-token guard that protects a
 * `reset` from a late deferred edit) are exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSourceEditing, resetSourceEditingEngineCache } from './useSourceEditing';
import type { Position } from './useSourceEditing';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';

beforeEach(() => {
  resetSourceEditingEngineCache();
});

function pos(line: number): Position {
  return { position: 0, extent: 0, content: '', line };
}

function renderCold() {
  const setCode = vi.fn();
  const context: CodeHighlighterContextType = { code: {}, setCode };
  const { result } = renderHook(() =>
    useSourceEditing({
      context,
      selectedVariantKey: 'Default',
      effectiveCode: { Default: { fileName: 'App.tsx', source: 'old' } },
      selectedVariant: { fileName: 'App.tsx', source: 'old' },
    }),
  );
  // The mount-warm effect may have loaded the engine; force the cold path so we
  // exercise `setSource`'s own deferral rather than the warm branch.
  resetSourceEditingEngineCache();
  return { setCode, setSource: result.current.setSource!, reset: result.current.reset! };
}

describe('useSourceEditing lazy engine (cold cache)', () => {
  it('defers a cold first edit, then commits it once the engine resolves', async () => {
    const { setCode, setSource } = renderCold();

    // Cold: the commit is deferred until the engine chunk loads, so nothing fires
    // synchronously.
    act(() => {
      setSource('new', undefined, pos(0));
    });
    expect(setCode).not.toHaveBeenCalled();

    // Once the dynamic import resolves, the first edit commits ONCE — the edited
    // source, tagged with the ORIGINAL build inputs so the runner renders a baseline
    // before swapping to the edit.
    await waitFor(() => expect(setCode).toHaveBeenCalledTimes(1));

    const updater = setCode.mock.calls[0][0];
    const committed = typeof updater === 'function' ? updater(undefined) : updater;
    expect(committed?.Default?.source).toBe('new');
    expect(committed?.Default?.original?.source).toBe('old');
  });

  it('lets a reset win over a still-pending cold edit (edit-token guard)', async () => {
    const { setCode, setSource, reset } = renderCold();

    act(() => {
      setSource('new', undefined, pos(0)); // cold -> deferred
    });
    act(() => {
      reset(); // synchronous: commits undefined and bumps the edit token
    });

    // The reset committed synchronously; the deferred edit has not run yet.
    expect(setCode).toHaveBeenCalledTimes(1);
    expect(setCode).toHaveBeenLastCalledWith(undefined);

    // Give the deferred edit a chance to resolve; it must NOT re-apply (the token
    // was superseded by the reset), so the committed state stays the reset.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    expect(setCode).toHaveBeenCalledTimes(1);
    expect(setCode).toHaveBeenLastCalledWith(undefined);
  });

  it('applies later edits synchronously once the engine has warmed', async () => {
    const { setCode, setSource } = renderCold();

    act(() => {
      setSource('first', undefined, pos(0)); // cold -> deferred, warms the cache
    });
    // First edit: a single commit (edited source + the baseline tag).
    await waitFor(() => expect(setCode).toHaveBeenCalledTimes(1));

    // Cache is now warm: this edit commits synchronously within the act.
    act(() => {
      setSource('second', undefined, pos(0));
    });
    expect(setCode).toHaveBeenCalledTimes(2);
  });
});

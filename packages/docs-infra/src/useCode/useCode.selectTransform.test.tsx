/**
 * @vitest-environment jsdom
 *
 * Focused tests for `useCode`'s `selectTransform` wrapper, which discards live
 * edits when the reader switches language. Switching applies the precomputed
 * TS↔JS delta, which no longer matches edited source — so the edit is reset to
 * the pristine build-time code first (see `useCode.ts`).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup
import { renderHook, act, cleanup } from '@testing-library/react';
import { useCode } from './useCode';
import type { ContentProps } from '../CodeHighlighter/types';
import { CodeHighlighterContext } from '../CodeHighlighter/CodeHighlighterContext';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';
import { CodeControllerContext } from '../CodeControllerContext/CodeControllerContext';
import type { CodeControllerContext as CodeControllerContextType } from '../CodeControllerContext/CodeControllerContext';

describe('useCode selectTransform (discard edits on switch)', () => {
  // jsdom in this runner does not expose `window.localStorage`; the preference
  // hooks touched during a transform select need it, so install an in-memory shim.
  beforeEach(() => {
    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          for (const key of Object.keys(store)) {
            delete store[key];
          }
        }),
        key: vi.fn(() => null),
        length: 0,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  const contentProps: ContentProps<{}> = {
    slug: 'switch-demo',
    code: { Default: { fileName: 'demo.tsx', source: 'const value = 1;' } },
  };

  const editedVariant = { Default: { fileName: 'demo.tsx', source: 'const value = 2;' } };

  // Wraps the hook in both contexts `useCode` reads: `CodeHighlighterContext`
  // (owns `setCode`, which `reset` calls) and `CodeControllerContext` (owns
  // `code`, which drives the "has live edits" check).
  function wrapper(
    highlighter: Partial<CodeHighlighterContextType>,
    controller: CodeControllerContextType,
  ) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        CodeControllerContext.Provider,
        { value: controller },
        React.createElement(
          CodeHighlighterContext.Provider,
          { value: highlighter as CodeHighlighterContextType },
          children,
        ),
      );
    };
  }

  it('resets the controlled code (discards edits) when switching language mid-edit', () => {
    const setCode = vi.fn();
    const { result } = renderHook(() => useCode(contentProps), {
      // Controller reports live edits (`code` is set); the switcher has `js`.
      wrapper: wrapper({ setCode, availableTransforms: ['js'] }, { code: editedVariant, setCode }),
    });

    act(() => {
      result.current.selectTransform('js');
    });

    // The reset clears the controlled code back to `null`.
    expect(setCode).toHaveBeenCalledWith(null);
  });

  it('does not reset anything when switching without live edits', () => {
    const setCode = vi.fn();
    const { result } = renderHook(() => useCode(contentProps), {
      // No controlled `code` => not editing => nothing to discard.
      wrapper: wrapper({ setCode, availableTransforms: ['js'] }, { setCode }),
    });

    act(() => {
      result.current.selectTransform('js');
    });

    expect(setCode).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 *
 * Focused tests for `useCode` discarding live edits across the collapse
 * boundary. A collapsed block is edited through its source projection, which
 * covers only the visible region, and the expanded view is edited against the
 * complete source, so neither draft survives the crossing (see `useCode.ts`).
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

describe('useCode reset on expand/collapse', () => {
  // jsdom in this runner does not expose `window.localStorage`; the preference
  // hooks `useCode` mounts need it, so install an in-memory shim.
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
    slug: 'reset-demo',
    code: { Default: { fileName: 'demo.tsx', source: 'const value = 1;' } },
  };

  const editedVariant = { Default: { fileName: 'demo.tsx', source: 'const value = 2;' } };

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

  function renderUseCode() {
    const setCode = vi.fn();
    const { result } = renderHook(() => useCode(contentProps), {
      wrapper: wrapper({ setCode }, { code: editedVariant, setCode }),
    });
    return { setCode, result };
  }

  it('discards the projection edit when expanding', () => {
    const { setCode, result } = renderUseCode();

    act(() => {
      result.current.expand();
    });

    expect(setCode).toHaveBeenCalledWith(null);
    expect(result.current.expanded).toBe(true);
  });

  it('discards the edit when a controlled write expands the block', () => {
    const { setCode, result } = renderUseCode();

    act(() => {
      result.current.setExpanded(true);
    });

    expect(setCode).toHaveBeenCalledWith(null);
    expect(result.current.expanded).toBe(true);
  });

  it('does not reset when the block is already expanded', () => {
    const { setCode, result } = renderUseCode();

    act(() => {
      result.current.setExpanded(true);
    });
    setCode.mockClear();

    act(() => {
      result.current.expand();
      result.current.setExpanded(true);
    });

    expect(setCode).not.toHaveBeenCalled();
  });

  it('discards the complete-source edit when collapsing', () => {
    const { setCode, result } = renderUseCode();

    act(() => {
      result.current.setExpanded(true);
    });
    setCode.mockClear();

    act(() => {
      result.current.setExpanded(false);
    });

    expect(setCode).toHaveBeenCalledWith(null);
    expect(result.current.expanded).toBe(false);
  });

  it('does not reset when the block is already collapsed', () => {
    const { setCode, result } = renderUseCode();

    act(() => {
      result.current.setExpanded(false);
    });

    expect(setCode).not.toHaveBeenCalled();
  });
});

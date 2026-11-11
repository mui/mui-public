/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ContentLoadingProps } from './types';
import type { FallbackNode } from './fallbackFormat';
import { useCodeFallback } from './useCodeFallback';

const source: FallbackNode[] = [['span', 'frame', { dataFrameType: 'focus' }, 'const x = 1;']];

function getCodeElement(props: ContentLoadingProps<object>) {
  const { result } = renderHook(() => useCodeFallback(props));
  return result.current.code as React.ReactElement<Record<string, unknown>>;
}

describe('useCodeFallback', () => {
  it('updates loading markup and variants after optional props change', () => {
    const { result, rerender } = renderHook(
      (props: ContentLoadingProps<object> | undefined) => useCodeFallback(props),
      { initialProps: undefined },
    );
    expect(result.current).toEqual({});
    const props: ContentLoadingProps<object> = {
      component: null,
      source,
      fileNames: ['Demo.ts'],
      language: 'ts',
      totalLines: 1,
      focusedLines: 1,
      extraVariants: { Other: { source } },
    };
    rerender(props);
    const first = result.current.code;
    expect(React.isValidElement(first) && first.props).toMatchObject({
      className: 'language-ts',
      'data-focused-lines': 1,
    });
    const changed: FallbackNode[] = [['span', 'frame', 'const changed = 2;']];
    rerender({
      ...props,
      source: changed,
      language: 'js',
      collapseToEmpty: true,
      extraVariants: { Updated: { source: changed } },
    });
    const next = result.current.code;
    expect(next).not.toBe(first);
    expect(React.isValidElement(next) && next.props).toMatchObject({
      className: 'language-js',
      'data-focused-lines': 0,
      'data-collapsible': '',
    });
    expect(JSON.stringify(result.current.source)).toContain('const changed = 2;');
    expect(Object.keys(result.current.extraVariants ?? {})).toEqual(['Updated']);
    expect(JSON.stringify(result.current.extraVariants)).toContain('const changed = 2;');
    rerender(props);
    expect(React.isValidElement(result.current.code) && result.current.code.props).toMatchObject({
      className: 'language-ts',
      'data-focused-lines': 1,
    });
    expect(Object.keys(result.current.extraVariants ?? {})).toEqual(['Other']);
    rerender(undefined);
    expect(result.current).toEqual({});
  });

  it('uses explicit collapsible metadata instead of deriving it from line counts', () => {
    const code = getCodeElement({
      component: null,
      fileNames: ['a.ts'],
      source,
      totalLines: 40,
      focusedLines: 12,
      collapsible: false,
    });

    expect(code.props['data-collapsible']).toBeUndefined();
  });

  it('forces collapsible metadata for render-time collapseToEmpty', () => {
    const code = getCodeElement({
      component: null,
      fileNames: ['a.ts'],
      source,
      totalLines: 40,
      focusedLines: 40,
      collapsible: false,
      collapseToEmpty: true,
    });

    expect(code.props['data-collapsible']).toBe('');
    expect(code.props['data-focused-lines']).toBe(0);
  });

  it('leaves non-collapse-to-empty fallback metadata unchanged', () => {
    const code = getCodeElement({
      component: null,
      fileNames: ['a.ts'],
      source,
      totalLines: 40,
      focusedLines: 40,
      collapsible: false,
      collapseToEmpty: false,
    });

    expect(code.props['data-collapsible']).toBeUndefined();
    expect(code.props['data-focused-lines']).toBe(40);
  });
});

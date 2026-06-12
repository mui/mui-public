/**
 * @vitest-environment jsdom
 */
import type * as React from 'react';
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

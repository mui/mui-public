import { describe, it, expect } from 'vitest';
import type { Element as HastElement } from 'hast';
import { isFrameSpan, hasClassName } from './isFrameSpan';

function element(className?: string | (string | number)[]): HastElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className },
    children: [],
  };
}

describe('isFrameSpan', () => {
  it('matches the string className shape (live / parsed HAST)', () => {
    expect(isFrameSpan(element('frame'))).toBe(true);
  });

  it('matches the array className shape (fallbackToHast / serialized HAST)', () => {
    expect(isFrameSpan(element(['frame']))).toBe(true);
    expect(isFrameSpan(element(['frame', 'extra']))).toBe(true);
  });

  it('does not match non-frame elements', () => {
    expect(isFrameSpan(element('line'))).toBe(false);
    expect(isFrameSpan(element(['line']))).toBe(false);
    expect(isFrameSpan(element())).toBe(false);
  });
});

describe('hasClassName', () => {
  it('matches both the string and array shapes for an arbitrary class', () => {
    expect(hasClassName(element('collapse'), 'collapse')).toBe(true);
    expect(hasClassName(element(['collapse', 'frame']), 'collapse')).toBe(true);
  });

  it('does not match a class the element lacks', () => {
    expect(hasClassName(element('frame'), 'collapse')).toBe(false);
    expect(hasClassName(element(), 'frame')).toBe(false);
  });
});

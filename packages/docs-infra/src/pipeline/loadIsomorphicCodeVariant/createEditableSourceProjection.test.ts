import { describe, expect, it } from 'vitest';
import type { Element, ElementContent } from 'hast';
import type { HastRoot, SourceComments } from '../../CodeHighlighter/types';
import { createEditableSourceProjection } from './createEditableSourceProjection';

function createFrame(lineNumbers: number[], frameType = 'focus', indentLevel?: number): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'frame', dataFrameType: frameType, dataFrameIndent: indentLevel },
    children: lineNumbers.map<ElementContent>((lineNumber) => ({
      type: 'element',
      tagName: 'span',
      properties: { className: 'line', dataLn: lineNumber },
      children: [],
    })),
  };
}

function createRoot(visibleLineGroups: number[][]): HastRoot {
  return {
    type: 'root',
    children: visibleLineGroups.map((lineNumbers) => createFrame(lineNumbers)),
  };
}

const focusComments: SourceComments = { 2: ['@focus'] };

describe('createEditableSourceProjection', () => {
  it('creates offsets for a contiguous start/end focus range', () => {
    const source = 'before\nfirst\nsecond\nafter';

    const projection = createEditableSourceProjection(source, createRoot([[2, 3]]), {
      2: ['@focus-start'],
      4: ['@focus-end'],
    });

    expect(projection).toEqual({
      source: 'first\nsecond',
      start: source.indexOf('first'),
      end: source.indexOf('second') + 'second'.length,
    });
    expect(`${source.slice(0, projection!.start)}edited${source.slice(projection!.end)}`).toBe(
      'before\nedited\nafter',
    );
  });

  it('creates a projection for a single focused line', () => {
    const source = 'before\nfocused\nafter';

    expect(createEditableSourceProjection(source, createRoot([[2]]), focusComments)).toEqual({
      source: 'focused',
      start: 7,
      end: 14,
    });
  });

  it('includes padding frames in the editable projection', () => {
    const source = 'hidden\npadding above\nfocused\npadding below\nhidden';
    const root = createRoot([[3]]);
    root.children.unshift(createFrame([2], 'padding-top'));
    root.children.push(createFrame([4], 'padding-bottom'));

    expect(createEditableSourceProjection(source, root, focusComments)?.source).toBe(
      'padding above\nfocused\npadding below',
    );
  });

  it('preserves the canonical source and records visually hidden indentation', () => {
    const source = 'before\n      first\n        second\nafter';
    const root = createRoot([]);
    root.children.push(createFrame([2, 3], 'focus', 3));

    expect(createEditableSourceProjection(source, root, focusComments)).toEqual({
      source: '      first\n        second',
      start: source.indexOf('      first'),
      end: source.indexOf('        second') + '        second'.length,
      indentation: '      ',
    });
  });

  it('returns no projection without authored focus metadata', () => {
    expect(createEditableSourceProjection('first\nsecond', createRoot([[1]]), undefined)).toBe(
      undefined,
    );
  });

  it('falls back when visible lines are non-contiguous', () => {
    expect(
      createEditableSourceProjection('first\nsecond\nthird', createRoot([[1], [3]]), focusComments),
    ).toBe(undefined);
  });

  it('preserves CRLF source and uses safe string offsets', () => {
    const source = 'before\r\nfirst\r\nsecond\r\nafter';
    const projection = createEditableSourceProjection(source, createRoot([[2, 3]]), focusComments);

    expect(projection).toEqual({
      source: 'first\r\nsecond',
      start: 8,
      end: 21,
    });
    expect(source.slice(projection!.start, projection!.end)).toBe(projection!.source);
  });
});

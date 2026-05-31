import { describe, it, expect } from 'vitest';
import type { ElementContent } from 'hast';
import { frameFallbackFromSpans } from './frameFallbackFromSpans';

describe('frameFallbackFromSpans', () => {
  const lineSpan = (value: string): ElementContent => ({
    type: 'element',
    tagName: 'span',
    properties: { className: 'line' },
    children: [{ type: 'text', value }],
  });

  it('collapses a plain frame to a single merged text node', () => {
    // Highlight spans are unwrapped and the line text + inter-line newlines
    // merge into one text node — identical to what `addLineGutters` records.
    const spans: ElementContent[] = [
      lineSpan('const a = 1;'),
      { type: 'text', value: '\n' },
      lineSpan('const b = 2;'),
    ];

    expect(frameFallbackFromSpans(spans)).toEqual([
      { type: 'text', value: 'const a = 1;\nconst b = 2;' },
    ]);
  });

  it('preserves a `.collapse` placeholder so the fallback keeps its height', () => {
    const spans: ElementContent[] = [
      lineSpan('const a = 1;'),
      { type: 'text', value: '\n' },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: 'collapse', dataLines: 2 },
        children: [
          { type: 'element', tagName: 'span', properties: {}, children: [] },
          { type: 'element', tagName: 'span', properties: {}, children: [] },
        ],
      },
    ];

    expect(frameFallbackFromSpans(spans)).toEqual([
      { type: 'text', value: 'const a = 1;\n' },
      {
        type: 'element',
        tagName: 'span',
        properties: { className: 'collapse', dataLines: 2 },
        children: [
          { type: 'element', tagName: 'span', properties: {}, children: [] },
          { type: 'element', tagName: 'span', properties: {}, children: [] },
        ],
      },
    ]);
  });
});

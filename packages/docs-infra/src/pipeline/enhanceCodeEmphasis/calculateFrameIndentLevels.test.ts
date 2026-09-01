import { describe, expect, it } from 'vitest';
import type { Element } from 'hast';
import type { FrameRange } from '../parseSource/calculateFrameRanges';
import { calculateFrameIndentLevels } from './calculateFrameIndentLevels';

function createLines(indents: number[]): Map<number, Element> {
  const lines = new Map<number, Element>();
  indents.forEach((indent, index) => {
    lines.set(index + 1, {
      type: 'element',
      tagName: 'span',
      properties: { className: ['line'], dataLn: index + 1 },
      children: [{ type: 'text', value: `${' '.repeat(indent)}value` }],
    });
  });
  return lines;
}

describe('calculateFrameIndentLevels', () => {
  it('should share the collapsed window indent across its focus and highlighted frames', () => {
    const lines = createLines([2, 6, 2, 0, 8]);
    const frameRanges: FrameRange[] = [
      { startLine: 1, endLine: 1, type: 'focus' },
      { startLine: 2, endLine: 2, type: 'highlighted', regionIndex: 0 },
      { startLine: 3, endLine: 3, type: 'focus' },
      { startLine: 4, endLine: 4, type: 'normal' },
      { startLine: 5, endLine: 5, type: 'highlighted-unfocused', regionIndex: 1 },
    ];

    expect(calculateFrameIndentLevels(frameRanges, lines)).toEqual(
      new Map([
        [0, 1],
        [1, 1],
        [2, 1],
        [4, 4],
      ]),
    );
  });

  it('should use the whole region indent for hidden frames of a truncated region', () => {
    const lines = createLines([0, 4, 4, 2]);
    const frameRanges: FrameRange[] = [
      { startLine: 1, endLine: 1, type: 'normal' },
      { startLine: 2, endLine: 3, type: 'focus', regionIndex: 0, truncated: 'visible' },
      { startLine: 4, endLine: 4, type: 'focus-unfocused', regionIndex: 0, truncated: 'hidden' },
    ];

    expect(calculateFrameIndentLevels(frameRanges, lines)).toEqual(
      new Map([
        [1, 2],
        [2, 1],
      ]),
    );
  });

  it('should return no levels when there are no region frames', () => {
    const lines = createLines([2, 2]);
    const frameRanges: FrameRange[] = [{ startLine: 1, endLine: 2, type: 'normal' }];

    expect(calculateFrameIndentLevels(frameRanges, lines)).toEqual(new Map());
  });
});

import { describe, it, expect } from 'vitest';
import type { Element, ElementContent } from 'hast';
import type { FrameRange } from './calculateFrameRanges';
import type { HastRoot } from '../../CodeHighlighter/types';
// eslint-disable-next-line import/extensions
import { restructureFrames } from './restructureFrames';

/**
 * Helper to create a line element.
 */
function createLine(lineNumber: number, text: string, indent: string = ''): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'line', dataLn: lineNumber },
    children: [{ type: 'text', value: `${indent}${text}` }],
  };
}

/**
 * Helper to create a frame element containing lines.
 */
function createFrame(lines: Element[], startLine: number, endLine: number): Element {
  const children: ElementContent[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    children.push(lines[i]);
    if (i < lines.length - 1) {
      children.push({ type: 'text', value: '\n' });
    }
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: 'frame',
      dataFrameStartLine: startLine,
      dataFrameEndLine: endLine,
    },
    children,
  };
}

/**
 * Helper to create a HastRoot with a single frame.
 */
function createRoot(lines: Element[], totalLines?: number): HastRoot {
  const frame = createFrame(lines, 1, lines.length);
  return {
    type: 'root',
    children: [frame],
    data: { totalLines: totalLines ?? lines.length },
  };
}

describe('restructureFrames', () => {
  describe('basic restructuring', () => {
    it('should split a frame around a highlighted line', () => {
      const lines = [
        createLine(1, 'const a = 1;'),
        createLine(2, 'const b = 2;'),
        createLine(3, 'const c = 3;'),
        createLine(4, 'const d = 4;'),
        createLine(5, 'const e = 5;'),
      ];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 3, type: 'highlighted' },
        { startLine: 4, endLine: 5, type: 'normal' },
      ];

      restructureFrames(root, frameRanges, new Map());

      expect(root.children).toHaveLength(3);

      // First frame: normal
      const frame1 = root.children[0] as Element;
      expect(frame1.properties?.dataFrameStartLine).toBe(1);
      expect(frame1.properties?.dataFrameEndLine).toBe(2);
      expect(frame1.properties?.dataFrameType).toBeUndefined();

      // Second frame: highlighted
      const frame2 = root.children[1] as Element;
      expect(frame2.properties?.dataFrameStartLine).toBe(3);
      expect(frame2.properties?.dataFrameEndLine).toBe(3);
      expect(frame2.properties?.dataFrameType).toBe('highlighted');

      // Third frame: normal
      const frame3 = root.children[2] as Element;
      expect(frame3.properties?.dataFrameStartLine).toBe(4);
      expect(frame3.properties?.dataFrameEndLine).toBe(5);
      expect(frame3.properties?.dataFrameType).toBeUndefined();
    });

    it('should create frames with padding types', () => {
      const lines = Array.from({ length: 10 }, (_, i) => createLine(i + 1, `line ${i + 1};`));
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'padding-top' },
        { startLine: 5, endLine: 5, type: 'highlighted' },
        { startLine: 6, endLine: 7, type: 'padding-bottom' },
        { startLine: 8, endLine: 10, type: 'normal' },
      ];

      restructureFrames(root, frameRanges, new Map());

      expect(root.children).toHaveLength(5);

      const frame2 = root.children[1] as Element;
      expect(frame2.properties?.dataFrameType).toBe('padding-top');

      const frame3 = root.children[2] as Element;
      expect(frame3.properties?.dataFrameType).toBe('highlighted');

      const frame4 = root.children[3] as Element;
      expect(frame4.properties?.dataFrameType).toBe('padding-bottom');
    });

    it('should handle a single highlighted frame', () => {
      const lines = [createLine(1, 'const only = true;')];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [{ startLine: 1, endLine: 1, type: 'highlighted' }];

      restructureFrames(root, frameRanges, new Map());

      expect(root.children).toHaveLength(1);
      const frame = root.children[0] as Element;
      expect(frame.properties?.dataFrameType).toBe('highlighted');
      expect(frame.properties?.dataFrameStartLine).toBe(1);
      expect(frame.properties?.dataFrameEndLine).toBe(1);
    });
  });

  describe('data-frame-indent', () => {
    it('should set indent level on highlighted frames', () => {
      const lines = [
        createLine(1, 'function test() {'),
        createLine(2, 'return (', '  '),
        createLine(3, '<div>', '    '),
        createLine(4, '<span>Test</span>', '      '),
        createLine(5, '</div>', '    '),
        createLine(6, ')', '  '),
        createLine(7, '}'),
      ];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 5, type: 'highlighted' },
        { startLine: 6, endLine: 7, type: 'normal' },
      ];

      // Region 0 covers lines 3-5, which have indent 4, 6, 4 spaces → min is 4 → level 2
      const regionIndentLevels = new Map<number, number>([[0, 2]]);

      restructureFrames(root, frameRanges, regionIndentLevels);

      const highlightedFrame = root.children[1] as Element;
      expect(highlightedFrame.properties?.dataFrameIndent).toBe(2);
    });

    it('should not set indent on normal frames', () => {
      const lines = [createLine(1, 'const a = 1;'), createLine(2, 'const b = 2;')];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [{ startLine: 1, endLine: 2, type: 'normal' }];

      restructureFrames(root, frameRanges, new Map());

      const frame = root.children[0] as Element;
      expect(frame.properties?.dataFrameIndent).toBeUndefined();
    });

    it('should set indent level 0 when no shared indent', () => {
      const lines = [createLine(1, 'no indent'), createLine(2, '  some indent', '')];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [{ startLine: 1, endLine: 2, type: 'highlighted' }];

      const regionIndentLevels = new Map<number, number>([[0, 0]]);

      restructureFrames(root, frameRanges, regionIndentLevels);

      const frame = root.children[0] as Element;
      expect(frame.properties?.dataFrameIndent).toBe(0);
    });
  });

  describe('preserves line content', () => {
    it('should preserve line elements and newlines between them', () => {
      const lines = [createLine(1, 'line 1'), createLine(2, 'line 2'), createLine(3, 'line 3')];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 1, type: 'normal' },
        { startLine: 2, endLine: 2, type: 'highlighted' },
        { startLine: 3, endLine: 3, type: 'normal' },
      ];

      restructureFrames(root, frameRanges, new Map());

      // Each frame should contain its line element
      const frame1 = root.children[0] as Element;
      const lineElements1 = frame1.children.filter((c): c is Element => c.type === 'element');
      expect(lineElements1).toHaveLength(1);
      expect(lineElements1[0].properties?.dataLn).toBe(1);

      const frame2 = root.children[1] as Element;
      const lineElements2 = frame2.children.filter((c): c is Element => c.type === 'element');
      expect(lineElements2).toHaveLength(1);
      expect(lineElements2[0].properties?.dataLn).toBe(2);
    });

    it('should include trailing newline text nodes within frames correctly', () => {
      const lines = [
        createLine(1, 'line 1'),
        createLine(2, 'line 2'),
        createLine(3, 'line 3'),
        createLine(4, 'line 4'),
      ];
      const root = createRoot(lines);

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 3, endLine: 4, type: 'highlighted' },
      ];

      restructureFrames(root, frameRanges, new Map());

      // First frame should have 2 lines with newlines
      const frame1 = root.children[0] as Element;
      const lineElements1 = frame1.children.filter((c): c is Element => c.type === 'element');
      expect(lineElements1).toHaveLength(2);
    });
  });
});

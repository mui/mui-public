import { describe, it, expect } from 'vitest';
import type { Element, ElementContent } from 'hast';
import type { FrameRange } from './calculateFrameRanges';
import type { HastRoot } from '../../CodeHighlighter/types';
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
function createTestFrame(lines: Element[]): Element {
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
      dataLined: '',
    },
    children,
  };
}

/**
 * Helper to create a HastRoot with a single frame.
 */
function createRoot(lines: Element[], totalLines?: number): HastRoot {
  const frame = createTestFrame(lines);
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
      expect(frame1.properties?.dataFrameType).toBeUndefined();
      expect(frame1.properties?.dataLined).toBe('');

      // Second frame: highlighted
      const frame2 = root.children[1] as Element;
      expect(frame2.properties?.dataFrameType).toBe('highlighted');
      expect(frame2.properties?.dataLined).toBe('');

      // Third frame: normal
      const frame3 = root.children[2] as Element;
      expect(frame3.properties?.dataFrameType).toBeUndefined();
      expect(frame3.properties?.dataLined).toBe('');
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
      expect(frame.properties?.dataLined).toBe('');
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
        { startLine: 3, endLine: 5, type: 'highlighted', regionIndex: 0 },
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

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'highlighted', regionIndex: 0 },
      ];

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

  describe('collapsed-lines placeholders', () => {
    function createPlaceholder(count: number): Element {
      return {
        type: 'element',
        tagName: 'span',
        properties: { className: 'collapse', dataLines: count },
        children: [],
      };
    }

    function findPlaceholders(root: HastRoot): Element[] {
      const found: Element[] = [];
      for (const frame of root.children) {
        if (frame.type !== 'element') {
          continue;
        }
        for (const child of frame.children) {
          if (
            child.type === 'element' &&
            child.tagName === 'span' &&
            child.properties?.className === 'collapse'
          ) {
            found.push(child);
          }
        }
      }
      return found;
    }

    it('preserves a placeholder span that appears after a line', () => {
      // Frame contains: line[1] "\n" placeholder line[3] "\n"
      const placeholder = createPlaceholder(1);
      const frame: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame', dataLined: '' },
        children: [
          createLine(1, 'const x = 1;'),
          { type: 'text', value: '\n' },
          placeholder,
          createLine(3, 'const y = 3;'),
          { type: 'text', value: '\n' },
        ],
      };
      const root: HastRoot = {
        type: 'root',
        children: [frame],
        data: { totalLines: 3 },
      };

      const frameRanges: FrameRange[] = [{ startLine: 1, endLine: 3, type: 'normal' }];

      restructureFrames(root, frameRanges, new Map());

      const placeholders = findPlaceholders(root);
      expect(placeholders).toHaveLength(1);
      expect(placeholders[0].properties?.dataLines).toBe(1);
    });

    it('keeps the placeholder in the same output frame as the preceding line', () => {
      const placeholder = createPlaceholder(2);
      const frame: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame', dataLined: '' },
        children: [
          createLine(1, 'a'),
          { type: 'text', value: '\n' },
          createLine(2, 'b'),
          { type: 'text', value: '\n' },
          placeholder,
          createLine(5, 'e'),
          { type: 'text', value: '\n' },
        ],
      };
      const root: HastRoot = {
        type: 'root',
        children: [frame],
        data: { totalLines: 5 },
      };

      const frameRanges: FrameRange[] = [
        { startLine: 1, endLine: 2, type: 'normal' },
        { startLine: 5, endLine: 5, type: 'normal' },
      ];

      restructureFrames(root, frameRanges, new Map());

      expect(root.children).toHaveLength(2);
      const firstFrame = root.children[0] as Element;
      const firstFramePlaceholders = firstFrame.children.filter(
        (c): c is Element => c.type === 'element' && c.properties?.className === 'collapse',
      );
      expect(firstFramePlaceholders).toHaveLength(1);
      expect(firstFramePlaceholders[0].properties?.dataLines).toBe(2);
    });

    it('moves the placeholder to the following kept line when the preceding anchor is dropped', () => {
      // Frame: line[2] placeholder line[5]. Range keeps only line 5.
      // The placeholder must still surface in the surviving frame —
      // collapsed-region affordances should anchor to either neighbor,
      // not silently disappear with the preceding line.
      const placeholder = createPlaceholder(2);
      const frame: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame', dataLined: '' },
        children: [
          createLine(2, 'b'),
          { type: 'text', value: '\n' },
          placeholder,
          createLine(5, 'e'),
          { type: 'text', value: '\n' },
        ],
      };
      const root: HastRoot = {
        type: 'root',
        children: [frame],
        data: { totalLines: 5 },
      };

      const frameRanges: FrameRange[] = [{ startLine: 5, endLine: 5, type: 'normal' }];

      restructureFrames(root, frameRanges, new Map());

      expect(root.children).toHaveLength(1);
      const onlyFrame = root.children[0] as Element;
      // Placeholder should appear before line 5 in the kept frame.
      const collapseIndex = onlyFrame.children.findIndex(
        (c) => c.type === 'element' && c.properties?.className === 'collapse',
      );
      const lineIndex = onlyFrame.children.findIndex(
        (c) =>
          c.type === 'element' && c.properties?.className === 'line' && c.properties.dataLn === 5,
      );
      expect(collapseIndex).toBeGreaterThanOrEqual(0);
      expect(lineIndex).toBeGreaterThanOrEqual(0);
      expect(collapseIndex).toBeLessThan(lineIndex);
    });

    it('drops a placeholder whose only anchors are both omitted from every range', () => {
      // Frame: line[1] placeholder line[2]. No range covers either line.
      // The placeholder has no kept anchor and should not be emitted.
      const placeholder = createPlaceholder(1);
      const frame: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame', dataLined: '' },
        children: [
          createLine(1, 'a'),
          { type: 'text', value: '\n' },
          placeholder,
          createLine(2, 'b'),
          { type: 'text', value: '\n' },
        ],
      };
      const root: HastRoot = {
        type: 'root',
        children: [frame],
        data: { totalLines: 2 },
      };

      const frameRanges: FrameRange[] = [];

      restructureFrames(root, frameRanges, new Map());

      expect(findPlaceholders(root)).toHaveLength(0);
    });
  });

  describe('per-frame fallback sync', () => {
    /**
     * Builds a root whose frames each carry a `data.fallback` text node, mirroring
     * the output of `addLineGutters`. `frameLineRanges` is a list of `[start, end]`
     * inclusive line numbers; `sourceLines` supplies the per-line text.
     */
    function createRootWithFallbacks(
      frameLineRanges: Array<[number, number]>,
      sourceLines: string[],
    ): HastRoot {
      const totalLines = sourceLines.length;
      const frames: Element[] = frameLineRanges.map(([start, end]) => {
        const lines: Element[] = [];
        for (let ln = start; ln <= end; ln += 1) {
          lines.push(createLine(ln, sourceLines[ln - 1]));
        }
        const frame = createTestFrame(lines);
        const joined = sourceLines.slice(start - 1, end).join('\n');
        const value = end < totalLines ? `${joined}\n` : joined;
        frame.data = { fallback: [{ type: 'text', value }] } as Element['data'];
        return frame;
      });
      return {
        type: 'root',
        children: frames,
        data: { totalLines },
      };
    }

    function fallbackText(frame: Element): string | undefined {
      const nodes = frame.data?.fallback;
      if (!nodes) {
        return undefined;
      }
      return nodes.map((node) => (node.type === 'text' ? node.value : '')).join('');
    }

    const source = ['a', 'b', 'c', 'd', 'e', 'f'];

    it('reuses fallbacks unchanged when frame ranges match', () => {
      const root = createRootWithFallbacks(
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        source,
      );

      restructureFrames(
        root,
        [
          { startLine: 1, endLine: 2, type: 'normal' },
          { startLine: 3, endLine: 4, type: 'normal' },
          { startLine: 5, endLine: 6, type: 'normal' },
        ],
        new Map(),
      );

      expect((root.children as Element[]).map(fallbackText)).toEqual(['a\nb\n', 'c\nd\n', 'e\nf']);
    });

    it('shifts fallback lines when frames are re-chunked', () => {
      const root = createRootWithFallbacks(
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        source,
      );

      restructureFrames(
        root,
        [
          { startLine: 1, endLine: 3, type: 'normal' },
          { startLine: 4, endLine: 6, type: 'highlighted' },
        ],
        new Map(),
      );

      expect((root.children as Element[]).map(fallbackText)).toEqual(['a\nb\nc\n', 'd\ne\nf']);
    });

    it('drops fallback text for collapsed (omitted) lines', () => {
      const root = createRootWithFallbacks(
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        source,
      );

      restructureFrames(
        root,
        [
          { startLine: 1, endLine: 2, type: 'normal' },
          { startLine: 5, endLine: 6, type: 'normal' },
        ],
        new Map(),
      );

      expect((root.children as Element[]).map(fallbackText)).toEqual(['a\nb\n', 'e\nf']);
    });

    it('leaves frames without fallback untouched', () => {
      const lines = [createLine(1, 'a'), createLine(2, 'b')];
      const root = createRoot(lines);

      restructureFrames(root, [{ startLine: 1, endLine: 2, type: 'normal' }], new Map());

      const frame = root.children[0] as Element;
      expect(frame.data?.fallback).toBeUndefined();
    });
  });
});

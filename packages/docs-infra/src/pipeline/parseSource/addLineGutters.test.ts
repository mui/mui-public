import { describe, expect, it } from 'vitest';
import type { Root } from 'hast';
import { starryNightGutter, countLines } from './addLineGutters';

describe('starryNightGutter', () => {
  it('should handle single line text without line breaks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'hello world',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'hello world' }],
          },
        ],
      },
    ]);
    expect((tree.data as any)?.totalLines).toBe(1);
  });

  it('should handle text with single line break', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\nline2',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'line1' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: 'line2' }],
          },
        ],
      },
    ]);
  });

  it('should handle text with multiple line breaks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\nline2\nline3',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'line1' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: 'line2' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 3 },
            children: [{ type: 'text', value: 'line3' }],
          },
        ],
      },
    ]);
  });

  it('should handle mixed text and element children', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'hello ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'keyword' },
          children: [{ type: 'text', value: 'const' }],
        },
        {
          type: 'text',
          value: '\nworld',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [
              { type: 'text', value: 'hello ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'keyword' },
                children: [{ type: 'text', value: 'const' }],
              },
            ],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: 'world' }],
          },
        ],
      },
    ]);
  });

  it('should handle empty lines by including newline inside the span', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\n\nline3',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'line1' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            // Empty lines contain the newline inside the span to avoid empty spans
            children: [{ type: 'text', value: '\n' }],
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 3 },
            children: [{ type: 'text', value: 'line3' }],
          },
        ],
      },
    ]);
  });

  it('should handle multiple consecutive empty lines', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'start\n\n\nend',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'start' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: '\n' }],
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 3 },
            children: [{ type: 'text', value: '\n' }],
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 4 },
            children: [{ type: 'text', value: 'end' }],
          },
        ],
      },
    ]);
  });

  it('should handle different line ending types (CRLF)', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\r\nline2',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'line1' }],
          },
          { type: 'text', value: '\r\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: 'line2' }],
          },
        ],
      },
    ]);
  });

  it('should handle text ending with line break', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\nline2\n',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: 'line1' }],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [{ type: 'text', value: 'line2' }],
          },
          { type: 'text', value: '\n' },
        ],
      },
    ]);
  });

  it('should handle empty tree', () => {
    const tree: Root = {
      type: 'root',
      children: [],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([]);
  });

  it('should handle tree with only non-text elements', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'keyword' },
          children: [{ type: 'text', value: 'const' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'variable' },
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'keyword' },
                children: [{ type: 'text', value: 'const' }],
              },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'variable' },
                children: [{ type: 'text', value: 'x' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('should handle complex case with text splits across multiple nodes', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'function ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'function-name' },
          children: [{ type: 'text', value: 'example' }],
        },
        {
          type: 'text',
          value: '() {\n  return ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'string' },
          children: [{ type: 'text', value: '"hello"' }],
        },
        {
          type: 'text',
          value: ';\n}',
        },
      ],
    };

    starryNightGutter(tree);

    expect(tree.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: {
          className: 'frame',
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [
              { type: 'text', value: 'function ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'function-name' },
                children: [{ type: 'text', value: 'example' }],
              },
              { type: 'text', value: '() {' },
            ],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 2 },
            children: [
              { type: 'text', value: '  return ' },
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'string' },
                children: [{ type: 'text', value: '"hello"' }],
              },
              { type: 'text', value: ';' },
            ],
          },
          { type: 'text', value: '\n' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 3 },
            children: [{ type: 'text', value: '}' }],
          },
        ],
      },
    ]);
  });

  // Test with syntax-highlighted code (demonstrates real-world usage)
  it('should handle pre-syntax-highlighted code correctly', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-e'] },
          children: [{ type: 'text', value: '.Label' }],
        },
        {
          type: 'text',
          value: ' {\n  ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'display' }],
        },
        {
          type: 'text',
          value: ': ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'flex' }],
        },
        {
          type: 'text',
          value: ';\n}',
        },
      ],
    };

    starryNightGutter(tree);

    // Should have 1 frame containing 3 lines (single frame, so no dataAsString)
    expect(tree.children).toHaveLength(1);
    const frame = tree.children[0];
    expect(frame.type).toBe('element');
    if (frame.type === 'element') {
      expect(frame.tagName).toBe('span');
      expect(frame.properties?.className).toBe('frame');
      expect(frame.properties?.dataAsString).toBeUndefined(); // No dataAsString for single frame

      // Count line elements within the frame
      const lineElements = frame.children.filter(
        (child) =>
          child.type === 'element' &&
          child.tagName === 'span' &&
          child.properties?.className === 'line',
      );
      expect(lineElements).toHaveLength(3);

      // Verify line numbers are correct
      lineElements.forEach((element, index) => {
        if (element.type === 'element') {
          expect(element.properties?.dataLn).toBe(index + 1);
        }
      });
    }

    // Verify total line count is stored in root data
    expect((tree.data as any)?.totalLines).toBe(3);
  });

  // Test that totalLines is correctly set
  it('should set totalLines in root data', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'a\nb\nc\nd\ne',
        },
      ],
    };

    starryNightGutter(tree);

    expect((tree.data as any)?.totalLines).toBe(5);
  });

  // Test frame splitting for large content
  it('should split lines into frames of 120 lines', () => {
    // Create a tree with 250 lines to test frame splitting
    const lines = Array.from({ length: 250 }, (_, i) => `line${i + 1}`);
    const sourceText = lines.join('\n');
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: sourceText,
        },
      ],
    };

    starryNightGutter(tree, lines, 120);

    // Should have 3 frames: 120 + 120 + 10 lines
    expect(tree.children).toHaveLength(3);

    // Check first frame (lines 1-120)
    const firstFrame = tree.children[0];
    expect(firstFrame.type).toBe('element');
    if (firstFrame.type === 'element') {
      expect(firstFrame.tagName).toBe('span');
      expect(firstFrame.properties?.className).toBe('frame');

      // Should have dataAsString since there are multiple frames
      expect(firstFrame.properties?.dataAsString).toBeDefined();
      expect(typeof firstFrame.properties?.dataAsString).toBe('string');

      const firstFrameLines = firstFrame.children.filter(
        (child) =>
          child.type === 'element' &&
          child.tagName === 'span' &&
          child.properties?.className === 'line',
      );
      expect(firstFrameLines).toHaveLength(120);

      // Check line numbers in first frame
      if (firstFrameLines[0].type === 'element') {
        expect(firstFrameLines[0].properties?.dataLn).toBe(1);
      }
      if (firstFrameLines[119].type === 'element') {
        expect(firstFrameLines[119].properties?.dataLn).toBe(120);
      }
    }

    // Check second frame (lines 121-240)
    const secondFrame = tree.children[1];
    expect(secondFrame.type).toBe('element');
    if (secondFrame.type === 'element') {
      expect(secondFrame.tagName).toBe('span');
      expect(secondFrame.properties?.className).toBe('frame');

      // Should have dataAsString since there are multiple frames
      expect(secondFrame.properties?.dataAsString).toBeDefined();
      expect(typeof secondFrame.properties?.dataAsString).toBe('string');

      const secondFrameLines = secondFrame.children.filter(
        (child) =>
          child.type === 'element' &&
          child.tagName === 'span' &&
          child.properties?.className === 'line',
      );
      expect(secondFrameLines).toHaveLength(120);

      // Check line numbers in second frame
      if (secondFrameLines[0].type === 'element') {
        expect(secondFrameLines[0].properties?.dataLn).toBe(121);
      }
      if (secondFrameLines[119].type === 'element') {
        expect(secondFrameLines[119].properties?.dataLn).toBe(240);
      }
    }

    // Check third frame (lines 241-250)
    const thirdFrame = tree.children[2];
    expect(thirdFrame.type).toBe('element');
    if (thirdFrame.type === 'element') {
      expect(thirdFrame.tagName).toBe('span');
      expect(thirdFrame.properties?.className).toBe('frame');

      // Should have dataAsString since there are multiple frames
      expect(thirdFrame.properties?.dataAsString).toBeDefined();
      expect(typeof thirdFrame.properties?.dataAsString).toBe('string');

      const thirdFrameLines = thirdFrame.children.filter(
        (child) =>
          child.type === 'element' &&
          child.tagName === 'span' &&
          child.properties?.className === 'line',
      );
      expect(thirdFrameLines).toHaveLength(10);

      // Check line numbers in third frame
      if (thirdFrameLines[0].type === 'element') {
        expect(thirdFrameLines[0].properties?.dataLn).toBe(241);
      }
      if (thirdFrameLines[9].type === 'element') {
        expect(thirdFrameLines[9].properties?.dataLn).toBe(250);
      }
    }

    // Verify total line count
    expect((tree.data as any)?.totalLines).toBe(250);
  });
});

describe('countLines', () => {
  it('should count lines correctly without mutating the tree', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\nline2\nline3',
        },
      ],
    };

    const originalChildren = JSON.parse(JSON.stringify(tree.children));
    const lineCount = countLines(tree);

    // Should return correct count
    expect(lineCount).toBe(3);

    // Should not mutate the tree
    expect(tree.children).toEqual(originalChildren);
    expect(tree.data).toBeUndefined();
  });

  it('should handle single line without newlines', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'hello world',
        },
      ],
    };

    expect(countLines(tree)).toBe(1);
  });

  it('should handle empty tree', () => {
    const tree: Root = {
      type: 'root',
      children: [],
    };

    expect(countLines(tree)).toBe(0);
  });

  it('should handle tree with only non-text elements', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'keyword' },
          children: [{ type: 'text', value: 'const' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'variable' },
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };

    expect(countLines(tree)).toBe(1);
  });

  it('should handle mixed text and element children with line breaks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'hello ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'keyword' },
          children: [{ type: 'text', value: 'const' }],
        },
        {
          type: 'text',
          value: '\nworld',
        },
      ],
    };

    expect(countLines(tree)).toBe(2);
  });

  it('should handle trailing newlines correctly', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'line1\nline2\n',
        },
      ],
    };

    expect(countLines(tree)).toBe(2);
  });

  it('should match starryNightGutter line count', () => {
    const tree1: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-e'] },
          children: [{ type: 'text', value: '.Label' }],
        },
        {
          type: 'text',
          value: ' {\n  ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'display' }],
        },
        {
          type: 'text',
          value: ': ',
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'flex' }],
        },
        {
          type: 'text',
          value: ';\n}',
        },
      ],
    };

    // Clone the tree for starryNightGutter
    const tree2 = JSON.parse(JSON.stringify(tree1));

    const countLinesResult = countLines(tree1);
    starryNightGutter(tree2);

    expect(countLinesResult).toBe((tree2.data as any)?.totalLines);
    expect(countLinesResult).toBe(3);
  });
});

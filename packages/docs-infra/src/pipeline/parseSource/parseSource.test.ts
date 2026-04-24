import { describe, expect, it, beforeAll } from 'vitest';
import type { Element, Root } from 'hast';
import type { ParseSource } from '../../CodeHighlighter/types';
import { createParseSource } from './parseSource';

function extractLineTokens(result: Root): Array<{ type: 'text' | 'element'; value: string }> {
  const frame = result.children[0];
  if (!frame || frame.type !== 'element') {
    return [];
  }

  const firstLine = frame.children.find((child): child is Element => {
    if (child.type !== 'element') {
      return false;
    }
    const className = child.properties?.className;
    if (Array.isArray(className)) {
      return className.includes('line');
    }
    return className === 'line';
  });

  if (!firstLine) {
    return [];
  }

  return firstLine.children.map((child) => {
    if (child.type === 'text') {
      return { type: 'text' as const, value: child.value };
    }
    if (child.type !== 'element') {
      return { type: 'text' as const, value: '' };
    }
    const className = child.properties?.className;
    let classText = '';
    if (Array.isArray(className)) {
      classText = className.join(' ');
    } else if (typeof className === 'string') {
      classText = className;
    }
    return { type: 'element' as const, value: classText };
  });
}

describe('parseSource', () => {
  let parseSource: ParseSource;

  beforeAll(async () => {
    parseSource = await createParseSource();
  });

  it('should handle unsupported file extension gracefully', async () => {
    const source = 'This is some unknown content';
    const result = parseSource(source, 'unknown.xyz') as Root;

    // Unsupported file types still get line gutters for enhancer compatibility
    expect(result.type).toBe('root');
    expect((result.data as { totalLines?: number })?.totalLines).toBe(1);
    // Should have a frame > line > text structure
    const frame = result.children[0] as Element;
    expect(frame.type).toBe('element');
    expect(frame.properties?.className).toBe('frame');
    const line = frame.children.find(
      (child): child is Element =>
        child.type === 'element' && child.properties?.className === 'line',
    );
    expect(line).toBeDefined();
    expect(line!.children).toEqual([{ type: 'text', value: source }]);
  });

  it('should handle file without extension gracefully', async () => {
    const source = 'Content without extension';
    const result = parseSource(source, 'README') as Root;

    expect(result.type).toBe('root');
    expect((result.data as { totalLines?: number })?.totalLines).toBe(1);
  });

  it('should handle empty content gracefully', async () => {
    const source = '';
    const result = parseSource(source, 'empty.txt') as Root;

    expect(result.type).toBe('root');
    // Empty content still gets line gutters (1 empty line)
    expect((result.data as { totalLines?: number })?.totalLines).toBe(1);
  });

  it('should handle content with special characters gracefully', async () => {
    const source = 'Content with symbols: @#$%^&*()';
    const result = parseSource(source, 'special.unknown') as Root;

    expect(result.type).toBe('root');
    expect((result.data as { totalLines?: number })?.totalLines).toBe(1);
  });

  it('should parse JavaScript content normally', async () => {
    const source = 'const x = 42;';
    const result = parseSource(source, 'test.js') as Root;

    // Should return a proper HAST tree with syntax highlighting
    expect(result.type).toBe('root');
    expect(result.children).toBeInstanceOf(Array);
    expect(result.children.length).toBeGreaterThan(0);
    // For supported languages, the structure will be more complex than our fallback
    expect(result.children[0].type).not.toBe('text');
  });

  it('should parse TypeScript content normally', async () => {
    const source = 'interface Test { value: number; }';
    const result = parseSource(source, 'test.ts') as Root;

    // Should return a proper HAST tree with syntax highlighting
    expect(result.type).toBe('root');
    expect(result.children).toBeInstanceOf(Array);
    expect(result.children.length).toBeGreaterThan(0);
    // For supported languages, the structure will be more complex than our fallback
    expect(result.children[0].type).not.toBe('text');
  });

  it('tokenizes TSX value object keys as plain text chunks', async () => {
    const source = "const obj = { key: 'val', count: 42 };";
    const result = parseSource(source, 'test.tsx') as Root;
    const tokens = extractLineTokens(result);

    expect(tokens).toEqual(
      expect.arrayContaining([
        { type: 'element', value: 'pl-k' },
        { type: 'element', value: 'pl-c1' },
        { type: 'text', value: ' { key: ' },
        { type: 'text', value: ', count: ' },
      ]),
    );
  });

  it('tokenizes type literal keys and colons as spans', async () => {
    const source = 'type Obj = { key: string; count: number };';
    const result = parseSource(source, 'test.tsx') as Root;
    const tokens = extractLineTokens(result);

    const elementValues = tokens
      .filter((token) => token.type === 'element')
      .map((token) => token.value);
    expect(elementValues.filter((value) => value === 'pl-v')).toHaveLength(2);
    expect(elementValues.filter((value) => value === 'pl-k')).toContain('pl-k');
    expect(tokens).toEqual(
      expect.arrayContaining([
        { type: 'element', value: 'pl-v' },
        { type: 'element', value: 'pl-k' },
      ]),
    );
  });

  it('tokenizes typed const declaration colon as a keyword span', async () => {
    const source = 'const obj: Obj = { key: "val" };';
    const result = parseSource(source, 'test.tsx') as Root;
    const tokens = extractLineTokens(result);

    const elementValues = tokens
      .filter((token) => token.type === 'element')
      .map((token) => token.value);
    expect(elementValues).toContain('pl-k');
    expect(tokens).toEqual(expect.arrayContaining([{ type: 'text', value: ' { key: ' }]));
  });
});

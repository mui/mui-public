import { describe, expect, it, beforeAll } from 'vitest';
import type { Element, Root } from 'hast';
import type { ParseSource } from '../../CodeHighlighter/types';
import { createParseSource, parsePlainText } from './parseSource';
import { isFrameSpan } from './isFrameSpan';
import { createEnhanceCodeEmphasis } from '../enhanceCodeEmphasis';

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

  it('extracts bare object keys into di-op spans', async () => {
    const source = "const obj = { key: 'val', count: 42 };";
    const result = parseSource(source, 'test.tsx') as Root;
    const tokens = extractLineTokens(result);

    const opKeys = tokens.filter(
      (token) => token.type === 'element' && token.value.split(' ').includes('di-op'),
    );
    expect(opKeys.length).toBe(2);
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

  it('extracts bare object keys into di-op spans even with a typed binding', async () => {
    const source = 'const obj: Obj = { key: "val" };';
    const result = parseSource(source, 'test.tsx') as Root;
    const tokens = extractLineTokens(result);

    const opKeys = tokens.filter(
      (token) => token.type === 'element' && token.value.split(' ').includes('di-op'),
    );
    expect(opKeys.length).toBe(1);
  });
});

describe('parsePlainText', () => {
  it('frames plain text with line gutters so the enhancer can run without highlighting', () => {
    // The deferred fallback parses with `parsePlainText` (no starry-night) instead of
    // skipping parsing, so the enhancer can compute the same frame structure as the
    // highlighted render. No grammar/instance is needed.
    const root = parsePlainText('const a = 1;\nconst b = 2;\nconst c = 3;');
    const frames = root.children.filter(
      (child): child is Element => child.type === 'element' && isFrameSpan(child),
    );
    expect(frames.length).toBeGreaterThan(0);
    // Line gutters are present (the structure the enhancer reads), but no syntax tokens.
    expect(JSON.stringify(root)).toContain('"line"');
    expect(JSON.stringify(root)).not.toContain('pl-');
  });

  it('lets the enhancer truncate an oversized source into a window + overflow (not one giant frame)', () => {
    // 30 lines with focusFramesMaxSize 12 → the enhancer produces a visible focus window
    // (truncated) plus a hidden normal overflow — identical to the highlighted render, so
    // the deferred fallback no longer flashes the full file then snaps to a small window.
    const source = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join(
      '\n',
    );
    const enhanced = createEnhanceCodeEmphasis({ focusFramesMaxSize: 12 })(
      parsePlainText(source),
      undefined,
      'test.ts',
    ) as Root;

    const frames = enhanced.children.filter(
      (child): child is Element => child.type === 'element' && isFrameSpan(child),
    );
    const focus = frames.find((frame) => frame.properties?.dataFrameType === 'focus');
    const overflow = frames.find((frame) => frame.properties?.dataFrameType === undefined);

    expect(focus?.properties?.dataFrameTruncated).toBe('visible');
    expect(overflow).toBeDefined();
    expect((enhanced.data as { focusedLines?: number })?.focusedLines).toBe(12);
  });
});

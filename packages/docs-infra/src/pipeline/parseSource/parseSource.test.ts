import { describe, expect, it, beforeAll } from 'vitest';
import type { Root } from 'hast';
import type { ParseSource } from '../../CodeHighlighter/types';
import { createParseSource } from './parseSource';

describe('parseSource', () => {
  let parseSource: ParseSource;

  beforeAll(async () => {
    parseSource = await createParseSource();
  });

  it('should handle unsupported file extension gracefully', async () => {
    const source = 'This is some unknown content';
    const result = parseSource(source, 'unknown.xyz') as Root;

    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'text',
          value: source,
        },
      ],
    });
  });

  it('should handle file without extension gracefully', async () => {
    const source = 'Content without extension';
    const result = parseSource(source, 'README') as Root;

    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'text',
          value: source,
        },
      ],
    });
  });

  it('should handle empty content gracefully', async () => {
    const source = '';
    const result = parseSource(source, 'empty.txt') as Root;

    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'text',
          value: source,
        },
      ],
    });
  });

  it('should handle content with special characters gracefully', async () => {
    const source = 'Content with symbols: @#$%^&*()';
    const result = parseSource(source, 'special.unknown') as Root;

    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'text',
          value: source,
        },
      ],
    });
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
});

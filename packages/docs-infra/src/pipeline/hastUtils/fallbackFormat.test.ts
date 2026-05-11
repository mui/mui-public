import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { hastToFallback, fallbackToHast, fallbackToText } from './fallbackFormat';
import type { FallbackNode } from './fallbackFormat';

function hast(...children: HastRoot['children']): HastRoot {
  return { type: 'root', children };
}

describe('hastToFallback', () => {
  it('should convert text nodes to plain strings', () => {
    const root = hast({ type: 'text', value: 'hello' });
    expect(hastToFallback(root)).toEqual(['hello']);
  });

  it('should produce length-2 tuple for element with no class and no props', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [{ type: 'text', value: 'hi' }],
    });
    expect(hastToFallback(root)).toEqual([['span', 'hi']]);
  });

  it('should produce length-3 tuple for element with class only', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: { className: ['token', 'keyword'] },
      children: [{ type: 'text', value: 'const' }],
    });
    expect(hastToFallback(root)).toEqual([['span', 'token keyword', 'const']]);
  });

  it('should produce length-4 tuple for element with class and props', () => {
    const root = hast({
      type: 'element',
      tagName: 'a',
      properties: { className: ['link'], href: '/foo' },
      children: [{ type: 'text', value: 'click' }],
    });
    expect(hastToFallback(root)).toEqual([['a', 'link', { href: '/foo' }, 'click']]);
  });

  it('should produce length-4 tuple for element with props but no class', () => {
    const root = hast({
      type: 'element',
      tagName: 'a',
      properties: { href: '/bar' },
      children: [{ type: 'text', value: 'link' }],
    });
    // classStr is '' but props exist, so length-4 with empty className
    expect(hastToFallback(root)).toEqual([['a', '', { href: '/bar' }, 'link']]);
  });

  it('should inline single text child as string', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [{ type: 'text', value: 'only child' }],
    });
    const [node] = hastToFallback(root);
    expect((node as [string, string])[1]).toBe('only child');
  });

  it('should use array for multiple children', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: {},
      children: [
        { type: 'text', value: 'a' },
        { type: 'text', value: 'b' },
      ],
    });
    expect(hastToFallback(root)).toEqual([['span', ['a', 'b']]]);
  });

  it('should handle empty children', () => {
    const root = hast({
      type: 'element',
      tagName: 'br',
      properties: {},
      children: [],
    });
    expect(hastToFallback(root)).toEqual([['br', []]]);
  });

  it('should handle nested elements', () => {
    const root = hast({
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['hl'] },
          children: [{ type: 'text', value: 'nested' }],
        },
      ],
    });
    expect(hastToFallback(root)).toEqual([['div', [['span', 'hl', 'nested']]]]);
  });

  it('should join className arrays with spaces', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: { className: ['a', 'b', 'c'] },
      children: [{ type: 'text', value: '' }],
    });
    expect(hastToFallback(root)).toEqual([['span', 'a b c', '']]);
  });

  it('should convert string className to string', () => {
    const root = hast({
      type: 'element',
      tagName: 'span',
      properties: { className: 'solo' },
      children: [{ type: 'text', value: 'x' }],
    });
    expect(hastToFallback(root)).toEqual([['span', 'solo', 'x']]);
  });
});

describe('fallbackToHast', () => {
  it('should convert plain string back to text node', () => {
    expect(fallbackToHast(['hello'])).toEqual(hast({ type: 'text', value: 'hello' }));
  });

  it('should convert length-2 tuple back to element', () => {
    const result = fallbackToHast([['span', 'hi']]);
    expect(result).toEqual(
      hast({
        type: 'element',
        tagName: 'span',
        properties: {},
        children: [{ type: 'text', value: 'hi' }],
      }),
    );
  });

  it('should convert length-3 tuple back to element with class', () => {
    const result = fallbackToHast([['span', 'token keyword', 'const']]);
    expect(result).toEqual(
      hast({
        type: 'element',
        tagName: 'span',
        properties: { className: ['token', 'keyword'] },
        children: [{ type: 'text', value: 'const' }],
      }),
    );
  });

  it('should convert length-4 tuple back to element with class and props', () => {
    const result = fallbackToHast([['a', 'link', { href: '/foo' }, 'click']]);
    expect(result).toEqual(
      hast({
        type: 'element',
        tagName: 'a',
        properties: { className: ['link'], href: '/foo' },
        children: [{ type: 'text', value: 'click' }],
      }),
    );
  });

  it('should handle array children in round-trip', () => {
    const result = fallbackToHast([['div', ['a', 'b']]]);
    expect(result).toEqual(
      hast({
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [
          { type: 'text', value: 'a' },
          { type: 'text', value: 'b' },
        ],
      }),
    );
  });
});

describe('hastToFallback → fallbackToHast round-trip', () => {
  it('should round-trip text nodes', () => {
    const original = hast({ type: 'text', value: 'hello world' });
    expect(fallbackToHast(hastToFallback(original))).toEqual(original);
  });

  it('should round-trip element with class', () => {
    const original = hast({
      type: 'element',
      tagName: 'span',
      properties: { className: ['token', 'keyword'] },
      children: [{ type: 'text', value: 'const' }],
    });
    expect(fallbackToHast(hastToFallback(original))).toEqual(original);
  });

  it('should round-trip element with class and props', () => {
    const original = hast({
      type: 'element',
      tagName: 'a',
      properties: { className: ['link'], href: '/foo' },
      children: [{ type: 'text', value: 'click' }],
    });
    expect(fallbackToHast(hastToFallback(original))).toEqual(original);
  });

  it('should round-trip nested structure', () => {
    const original = hast(
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['line'] },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['token', 'keyword'] },
            children: [{ type: 'text', value: 'const' }],
          },
          { type: 'text', value: ' ' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['token', 'variable'] },
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
      { type: 'text', value: '\n' },
    );
    expect(fallbackToHast(hastToFallback(original))).toEqual(original);
  });

  it('should round-trip bare element (no class, no props)', () => {
    const original = hast({
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [{ type: 'text', value: 'plain' }],
    });
    expect(fallbackToHast(hastToFallback(original))).toEqual(original);
  });
});

describe('fallbackToText', () => {
  it('should extract text from plain strings', () => {
    expect(fallbackToText(['hello', ' ', 'world'])).toBe('hello world');
  });

  it('should extract text from length-2 tuples', () => {
    expect(fallbackToText([['span', 'hi']])).toBe('hi');
  });

  it('should extract text from length-3 tuples', () => {
    expect(fallbackToText([['span', 'token', 'const']])).toBe('const');
  });

  it('should extract text from length-4 tuples', () => {
    expect(fallbackToText([['a', 'link', { href: '/' }, 'click']])).toBe('click');
  });

  it('should extract text from nested structures', () => {
    const nodes: FallbackNode[] = [
      ['span', [['span', 'kw', 'const'], ' x = ', ['span', 'num', '1']]],
      '\n',
    ];
    expect(fallbackToText(nodes)).toBe('const x = 1\n');
  });

  it('should return empty string for empty input', () => {
    expect(fallbackToText([])).toBe('');
  });

  it('should handle mixed text and elements', () => {
    const nodes: FallbackNode[] = ['before ', ['span', 'mid'], ' after'];
    expect(fallbackToText(nodes)).toBe('before mid after');
  });
});

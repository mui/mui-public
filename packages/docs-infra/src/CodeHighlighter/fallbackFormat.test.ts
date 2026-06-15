import { describe, it, expect } from 'vitest';
import type { Root as HastRoot, Element as HastElement, ElementContent } from 'hast';
import {
  hastToFallback,
  fallbackToHast,
  fallbackToText,
  buildRootFallback,
  buildCriticalFallback,
  promoteCriticalFallback,
  redistributeRootFallback,
  collapsedVisibleFallback,
} from './fallbackFormat';
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

/**
 * Builds a `span.frame` element with the given `data.fallback` text and one
 * `.line` child per line (highlighting spans omitted — only the structure
 * `buildRootFallback` cares about).
 */
function frameWithFallback(
  lineNumbers: number[],
  fallbackText: string,
  extraProps: Record<string, unknown> = {},
): HastElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: 'frame', dataLined: '', ...extraProps },
    children: lineNumbers.map((ln) => ({
      type: 'element',
      tagName: 'span',
      properties: { className: ['line'], dataLn: ln },
      children: [{ type: 'text', value: `line${ln}` }],
    })),
    data: { fallback: [{ type: 'text', value: fallbackText }] } as HastElement['data'],
  };
}

describe('buildRootFallback', () => {
  it('wraps each frame plain text in a frame element, dropping data-lined', () => {
    const root: HastRoot = {
      type: 'root',
      children: [frameWithFallback([1, 2], 'a\nb\n'), frameWithFallback([3], 'c')],
    };
    expect(buildRootFallback(root)).toEqual([
      ['span', 'frame', 'a\nb\n'],
      ['span', 'frame', 'c'],
    ]);
  });

  it('preserves non-data-lined frame attributes', () => {
    const root: HastRoot = {
      type: 'root',
      children: [frameWithFallback([1], 'x', { dataFrameType: 'highlighted' })],
    };
    expect(buildRootFallback(root)).toEqual([
      ['span', 'frame', { dataFrameType: 'highlighted' }, 'x'],
    ]);
  });

  it('keeps non-frame top-level nodes in place', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        frameWithFallback([1], 'a\n'),
        { type: 'text', value: '\n' },
        frameWithFallback([2], 'b'),
      ],
    };
    expect(buildRootFallback(root)).toEqual([
      ['span', 'frame', 'a\n'],
      '\n',
      ['span', 'frame', 'b'],
    ]);
  });

  it('falls back to collecting frame text when data.fallback is absent', () => {
    const frame: HastElement = {
      type: 'element',
      tagName: 'span',
      properties: { className: 'frame', dataLined: '' },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['line'], dataLn: 1 },
          children: [{ type: 'text', value: 'hello' }],
        },
        { type: 'text', value: '\n' },
      ],
    };
    const root: HastRoot = { type: 'root', children: [frame] };
    expect(buildRootFallback(root)).toEqual([['span', 'frame', 'hello\n']]);
  });
});

describe('buildCriticalFallback / promoteCriticalFallback', () => {
  // A frame whose highlighted `.line` children render exactly the text its
  // `data.fallback` carries (mirroring addLineGutters). A token `['cls', text]`
  // with a class becomes a `<span class>`; with an empty class it stays a bare
  // text node — so a line mixes highlighted and plain runs, like real output.
  function tokenFrame(
    lines: Array<Array<[className: string, text: string]>>,
    trailingNewline: boolean,
    extraProps: Record<string, unknown> = {},
  ): HastElement {
    const children: ElementContent[] = [];
    lines.forEach((tokens, index) => {
      children.push({
        type: 'element',
        tagName: 'span',
        properties: { className: ['line'], dataLn: index + 1 },
        children: tokens.map(([className, value]) =>
          className
            ? {
                type: 'element' as const,
                tagName: 'span',
                properties: { className },
                children: [{ type: 'text' as const, value }],
              }
            : { type: 'text' as const, value },
        ),
      });
      if (index < lines.length - 1 || trailingNewline) {
        children.push({ type: 'text', value: '\n' });
      }
    });
    const text = `${lines
      .map((tokens) => tokens.map(([, value]) => value).join(''))
      .join('\n')}${trailingNewline ? '\n' : ''}`;
    return {
      type: 'element',
      tagName: 'span',
      properties: { className: 'frame', dataLined: '', ...extraProps },
      children,
      data: { fallback: [{ type: 'text', value: text }] } as HastElement['data'],
    };
  }

  it('returns an empty diff when no frames are visible (nothing to promote)', () => {
    const root = hast(tokenFrame([[['pl-k', 'const']]], true), tokenFrame([[['', 'y']]], false));
    expect(buildCriticalFallback(root, {})).toEqual({});
    // Promoting an empty diff leaves the plain fallback untouched.
    expect(promoteCriticalFallback(buildRootFallback(root), {})).toEqual(buildRootFallback(root));
  });

  it('carries ONLY the visible frames, keyed by frame index (no off-screen duplication)', () => {
    const root = hast(
      tokenFrame([[['pl-k', 'const']]], true),
      tokenFrame([[['pl-s', 'y']]], false),
    );
    const critical = buildCriticalFallback(root, { 0: true });
    // Sparse: only the visible frame 0 is stored — the hidden frame 1 is omitted
    // (it is byte-identical to `fallback`, so storing it would just duplicate it).
    expect(Object.keys(critical)).toEqual(['0']);
    expect(JSON.stringify(critical[0])).toContain('pl-k');
  });

  it('drops data-lined from the stored frames', () => {
    const root = hast(tokenFrame([[['pl-k', 'const']]], false));
    expect(JSON.stringify(buildCriticalFallback(root, { 0: true }))).not.toContain('dataLined');
  });

  it('promotes the diff onto the plain fallback: visible highlighted, the rest plain', () => {
    const root = hast(
      tokenFrame([[['pl-k', 'const']]], true),
      tokenFrame([[['pl-s', 'y']]], false),
    );
    const promoted = promoteCriticalFallback(
      buildRootFallback(root),
      buildCriticalFallback(root, { 0: true }),
    );
    // Visible frame keeps the token span; non-visible frame stays flat plain text.
    expect(JSON.stringify(promoted[0])).toContain('pl-k');
    expect(promoted[1]).toEqual(['span', 'frame', 'y']);
  });

  it('preserves the dictionary text byte-for-byte after promotion, for any selection', () => {
    const root = hast(
      tokenFrame(
        [
          [
            ['pl-k', 'const'],
            ['', ' x = 1'],
          ],
        ],
        true,
      ),
      tokenFrame([[['', 'plain line']]], true),
      tokenFrame([[['pl-c', '// end']]], false),
    );
    const plain = buildRootFallback(root);
    const plainText = fallbackToText(plain);
    const selections: Array<{ [key: number]: boolean }> = [
      {},
      { 0: true },
      { 1: true },
      { 0: true, 2: true },
      { 0: true, 1: true, 2: true },
    ];
    selections.forEach((visible) => {
      expect(
        fallbackToText(promoteCriticalFallback(plain, buildCriticalFallback(root, visible))),
      ).toBe(plainText);
    });
  });

  it('matches frames by index over frame spans only, ignoring inter-frame nodes', () => {
    const root = hast(
      tokenFrame([[['', 'a']]], true),
      { type: 'text', value: '\n' },
      tokenFrame([[['pl-k', 'b']]], false),
    );
    // The diff is keyed by frame index (1), not array position.
    expect(Object.keys(buildCriticalFallback(root, { 1: true }))).toEqual(['1']);
    const promoted = promoteCriticalFallback(
      buildRootFallback(root),
      buildCriticalFallback(root, { 1: true }),
    );
    expect(promoted[0]).toEqual(['span', 'frame', 'a\n']); // frame index 0 → plain
    expect(promoted[1]).toBe('\n'); // inter-frame node preserved in place
    expect(JSON.stringify(promoted[2])).toContain('pl-k'); // frame index 1 → highlighted
  });
});

describe('redistributeRootFallback', () => {
  it('assigns each fallback frame text onto the matching HAST frame', () => {
    const fallback: FallbackNode[] = [
      ['span', 'frame', 'a\nb\n'],
      ['span', 'frame', 'c'],
    ];
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame', dataLined: '' },
          children: [],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame', dataLined: '' },
          children: [],
        },
      ],
    };

    redistributeRootFallback(root, fallback);

    expect((root.children[0] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'a\nb\n' },
    ]);
    expect((root.children[1] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'c' },
    ]);
  });

  it('skips non-frame fallback entries to keep frames aligned', () => {
    const fallback: FallbackNode[] = [['span', 'frame', 'a\n'], '\n', ['span', 'frame', 'b']];
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame', dataLined: '' },
          children: [],
        },
        { type: 'text', value: '\n' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame', dataLined: '' },
          children: [],
        },
      ],
    };

    redistributeRootFallback(root, fallback);

    expect((root.children[0] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'a\n' },
    ]);
    expect((root.children[2] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'b' },
    ]);
  });

  it('round-trips with buildRootFallback', () => {
    const built: HastRoot = {
      type: 'root',
      children: [frameWithFallback([1, 2], 'a\nb\n'), frameWithFallback([3], 'c')],
    };
    const fallback = buildRootFallback(built);

    // Fresh decoded-style tree with the same frame structure but no fallback yet.
    const decoded: HastRoot = {
      type: 'root',
      children: [frameWithFallback([1, 2], ''), frameWithFallback([3], '')].map((frame) => ({
        ...frame,
        data: undefined,
      })) as HastElement[],
    };

    redistributeRootFallback(decoded, fallback);

    expect((decoded.children[0] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'a\nb\n' },
    ]);
    expect((decoded.children[1] as HastElement).data?.fallback).toEqual([
      { type: 'text', value: 'c' },
    ]);
  });
});

describe('collapsedVisibleFallback', () => {
  function frameNode(type: string | undefined, text: string): FallbackNode {
    return type ? ['span', 'frame', { dataFrameType: type }, text] : ['span', 'frame', text];
  }

  it('slices the contiguous focused window out of surrounding normal frames', () => {
    const fallback: FallbackNode[] = [
      frameNode(undefined, 'before\n'),
      frameNode('padding-top', 'pt\n'),
      frameNode('highlighted', 'hl\n'),
      frameNode('padding-bottom', 'pb\n'),
      frameNode(undefined, 'after\n'),
    ];
    expect(collapsedVisibleFallback(fallback)).toEqual([
      frameNode('padding-top', 'pt\n'),
      frameNode('highlighted', 'hl\n'),
      frameNode('padding-bottom', 'pb\n'),
    ]);
  });

  it('keeps inter-frame nodes inside the window', () => {
    const fallback: FallbackNode[] = [
      frameNode(undefined, 'before\n'),
      frameNode('focus', 'a\n'),
      '\n',
      frameNode('focus', 'b\n'),
    ];
    expect(collapsedVisibleFallback(fallback)).toEqual([
      frameNode('focus', 'a\n'),
      '\n',
      frameNode('focus', 'b\n'),
    ]);
  });

  it('falls back to the first frame when there are no emphasis frames', () => {
    const fallback: FallbackNode[] = [frameNode(undefined, 'one\n'), frameNode(undefined, 'two\n')];
    expect(collapsedVisibleFallback(fallback)).toEqual([frameNode(undefined, 'one\n')]);
  });

  it('does not treat unfocused emphasis frames as visible', () => {
    // `highlighted-unfocused` is dimmed, not part of the collapsed window.
    const fallback: FallbackNode[] = [
      frameNode('highlighted-unfocused', 'dim\n'),
      frameNode('highlighted', 'hl\n'),
    ];
    expect(collapsedVisibleFallback(fallback)).toEqual([frameNode('highlighted', 'hl\n')]);
  });

  it('returns a fallback with no frames unchanged', () => {
    const fallback: FallbackNode[] = ['just text\n'];
    expect(collapsedVisibleFallback(fallback)).toBe(fallback);
  });

  it('returns an empty array when the block collapses to nothing', () => {
    // oversizedFocus: 'hide': focusedLines === 0 → the collapsed window is empty,
    // so no first-frame fallback is painted.
    const fallback: FallbackNode[] = [
      frameNode('highlighted-unfocused', 'a\n'),
      frameNode(undefined, 'b\n'),
    ];
    expect(collapsedVisibleFallback(fallback, true)).toEqual([]);
  });
});

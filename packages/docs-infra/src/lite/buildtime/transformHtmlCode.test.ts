import { describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { transformHtmlCode } from './transformHtmlCode';

function textContent(node: RootContent | Root): string {
  if (node.type === 'text') {
    return node.value;
  }
  if ('children' in node) {
    return node.children.map((child) => textContent(child)).join('');
  }
  return '';
}

function codeBlock(source: string, language = 'tsx', properties: Element['properties'] = {}): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: [`language-${language}`], ...properties },
            children: [{ type: 'text', value: source }],
          },
        ],
      },
    ],
  };
}

async function transform(tree: Root): Promise<Root> {
  const transformer = transformHtmlCode();
  transformer(tree);
  return tree;
}

function precomputeOf(tree: Root) {
  const pre = tree.children[0] as Element;
  return JSON.parse(String(pre.properties.dataPrecompute)) as {
    Default: {
      source: Root & {
        data: { totalLines: number; focusedLines: number; collapsible: boolean };
      };
      language?: string;
      fileName?: string;
      totalLines: number;
      focusedLines: number;
      collapsible: boolean;
    };
  };
}

describe('transformHtmlCode', () => {
  it('highlights fenced code with the lite parser and preserves content props', async () => {
    const tree = await transform(
      codeBlock(['const value = 1; // @highlight', 'console.log(value);'].join('\n'), 'tsx', {
        dataTitle: 'Example',
      }),
    );
    const pre = tree.children[0] as Element;
    const variant = precomputeOf(tree).Default;

    expect(variant.language).toBe('tsx');
    expect(variant.totalLines).toBe(2);
    expect(textContent(variant.source)).toBe('const value = 1;\nconsole.log(value);');
    expect(JSON.stringify(variant.source)).toContain('pl-k');
    expect(JSON.stringify(variant.source)).toContain('dataHl');
    expect(pre.properties.dataContentProps).toBe('{"title":"Example"}');
  });

  it('splits a late focus range and exposes its line counts', async () => {
    const source = [
      ...Array.from({ length: 14 }, (unused, index) => `const value${index} = ${index};`),
      '// @focus-start',
      'const focused = true;',
      '// @focus-end',
      'console.log(focused);',
    ].join('\n');
    const variant = precomputeOf(await transform(codeBlock(source))).Default;

    expect(variant.source.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ dataFrameType: 'focus' }),
        }),
      ]),
    );
    expect(variant.focusedLines).toBe(1);
    expect(variant.totalLines).toBe(16);
    expect(variant.collapsible).toBe(true);
  });

  it('preserves emphasis comments when displayComments is enabled', async () => {
    const tree = await transform(
      codeBlock('const value = 1; // @highlight', 'ts', { dataDisplayComments: 'true' }),
    );

    expect(textContent(precomputeOf(tree).Default.source)).toContain('@highlight');
  });

  it('preserves filenames and excludes reserved metadata from content props', async () => {
    const tree = await transform(
      codeBlock('const value: string = "test";', 'ts', {
        dataFilename: 'example.ts',
        dataVariant: 'main',
        dataTransform: 'true',
        dataTitle: 'Example',
      }),
    );
    const pre = tree.children[0] as Element;

    expect(precomputeOf(tree).Default.fileName).toBe('example.ts');
    expect(pre.properties.dataContentProps).toBe('{"title":"Example"}');
  });

  it('serializes display flags as booleans', async () => {
    const tree = await transform(
      codeBlock('const value = 1;', 'ts', {
        dataCollapseToEmpty: 'false',
        dataInitialExpanded: '',
      }),
    );
    const pre = tree.children[0] as Element;

    expect(JSON.parse(String(pre.properties.dataContentProps))).toEqual({
      collapseToEmpty: false,
      initialExpanded: true,
    });
  });

  it('does not emit content props when none were provided', async () => {
    const tree = await transform(codeBlock('const value = 1;', 'ts'));
    const pre = tree.children[0] as Element;

    expect(pre.properties.dataContentProps).toBeUndefined();
  });

  it('extracts nested source text without losing whitespace', async () => {
    const tree = codeBlock('', 'js');
    const pre = tree.children[0] as Element;
    const code = pre.children[0] as Element;
    code.children = [
      { type: 'text', value: 'const ' },
      {
        type: 'element',
        tagName: 'span',
        properties: {},
        children: [{ type: 'text', value: 'x' }],
      },
      { type: 'text', value: ' = 42;' },
    ];
    await transform(tree);

    expect(textContent(precomputeOf(tree).Default.source)).toBe('const x = 42;');
  });

  it('processes empty and untyped fenced code', async () => {
    const tree = codeBlock('   ', '', { className: [] });
    const variant = precomputeOf(await transform(tree)).Default;

    expect(variant.language).toBeUndefined();
    expect(textContent(variant.source)).toBe('   ');
  });

  it('transforms every fenced block independently', async () => {
    const first = codeBlock('const first = 1;', 'js').children[0];
    const second = codeBlock('const second = 2;', 'ts').children[0];
    const tree: Root = { type: 'root', children: [first, second] };
    await transform(tree);

    for (const child of tree.children) {
      expect((child as Element).properties.dataPrecompute).toBeTruthy();
    }
  });

  it('leaves non-code pre elements and existing precomputes unchanged', async () => {
    const plain: Element = {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'text', value: 'plain' }],
    };
    const existing: Element = {
      type: 'element',
      tagName: 'pre',
      properties: { dataPrecompute: '{}' },
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-ts'] },
          children: [{ type: 'text', value: 'const value = 1;' }],
        },
      ],
    };
    const tree: Root = { type: 'root', children: [plain, existing] };
    await transform(tree);

    expect(plain.children).toEqual([{ type: 'text', value: 'plain' }]);
    expect(existing.properties.dataPrecompute).toBe('{}');
    expect(textContent(existing)).toBe('const value = 1;');
  });

  it('highlights HTML fences', async () => {
    const variant = precomputeOf(
      await transform(codeBlock('<button type="button">Save</button>', 'html')),
    ).Default;

    expect(JSON.stringify(variant.source)).toContain('pl-ent');
    expect(JSON.stringify(variant.source)).toContain('pl-ak');
  });

  it('highlights inline code with the lite parser', async () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-ts'] },
              children: [{ type: 'text', value: 'string' }],
            },
          ],
        },
      ],
    };
    await transform(tree);
    const paragraph = tree.children[0] as Element;
    const code = paragraph.children[0] as Element;

    expect(code.properties.dataInline).toBe('');
    expect(code.children).toEqual([
      expect.objectContaining({ properties: { className: ['pl-c1', 'pl-bt'] } }),
    ]);
  });

  it('leaves unsupported inline languages unchanged', async () => {
    const code: Element = {
      type: 'element',
      tagName: 'code',
      properties: { className: ['language-bash'] },
      children: [{ type: 'text', value: 'pnpm install' }],
    };
    const tree: Root = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [code] }],
    };
    await transform(tree);

    expect(code.children).toEqual([{ type: 'text', value: 'pnpm install' }]);
    expect(code.properties).not.toHaveProperty('dataInline');
  });

  it.each([
    ['ts', 'const value: string = "test";'],
    ['js', 'function run() { return 42; }'],
    ['tsx', '<Button disabled />'],
    ['css', '.root { color: red; }'],
    ['json', '{ "key": true }'],
    ['html', '<button disabled>Save</button>'],
  ])('highlights inline %s while preserving its text', async (language, source) => {
    const code: Element = {
      type: 'element',
      tagName: 'code',
      properties: { className: [`language-${language}`] },
      children: [{ type: 'text', value: source }],
    };
    const tree: Root = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [code] }],
    };
    await transform(tree);

    expect(code.properties.dataInline).toBe('');
    expect(textContent(code)).toBe(source);
    expect(code.children.some((child) => child.type === 'element')).toBe(true);
  });

  it('handles whitespace and multiline inline code', async () => {
    const source = '{\n  foo: string;\n  bar: number;\n}';
    const code: Element = {
      type: 'element',
      tagName: 'code',
      properties: { className: ['language-ts'] },
      children: [{ type: 'text', value: source }],
    };
    const tree: Root = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [code] }],
    };
    await transform(tree);

    expect(textContent(code)).toBe(source);
    expect(code.properties.dataInline).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import { transformMarkdownCode } from './transformMarkdownCode';

describe('transformMarkdownCode', () => {
  it('passes fence language and metadata to rehype', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'tsx',
          meta: 'title="Example" displayComments collapse-to-empty=false',
          value: 'const value = 1;',
        },
      ],
    };
    transformMarkdownCode()(tree);
    const code = tree.children[0];

    expect(code.data?.hProperties).toEqual({
      className: ['language-tsx'],
      dataTitle: 'Example',
      dataDisplayComments: 'true',
      dataCollapseToEmpty: 'false',
    });
  });

  it('adds the default inline language and preserves existing classes', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'inlineCode',
              value: 'string',
              data: { hProperties: { className: ['existing'] } },
            },
          ],
        },
      ],
    };
    transformMarkdownCode()(tree);
    const paragraph = tree.children[0];
    const code = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;

    expect(code?.data?.hProperties).toEqual({ className: ['existing', 'language-tsx'] });
  });

  it('uses and strips an explicit inline language suffix', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: 'color{:css}' }] }],
    };
    transformMarkdownCode({ defaultInlineCodeLanguage: false })(tree);
    const paragraph = tree.children[0];
    const code = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;

    expect(code).toMatchObject({
      value: 'color',
      data: { hProperties: { className: ['language-css'] } },
    });
  });

  it('leaves bare inline code untyped when the default is disabled', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: 'value' }] }],
    };
    transformMarkdownCode({ defaultInlineCodeLanguage: false })(tree);
    const paragraph = tree.children[0];
    const code = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;

    expect(code?.data).toBeUndefined();
  });

  it('applies a custom default to every inline code node', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'first' },
            { type: 'text', value: ' and ' },
            { type: 'inlineCode', value: 'second' },
          ],
        },
      ],
    };
    transformMarkdownCode({ defaultInlineCodeLanguage: 'ts' })(tree);
    const paragraph = tree.children[0];

    expect(paragraph.type === 'paragraph' ? paragraph.children : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: { hProperties: { className: ['language-ts'] } } }),
        expect.objectContaining({ data: { hProperties: { className: ['language-ts'] } } }),
      ]),
    );
  });

  it.each([
    ['<Component />{:jsx}', '<Component />', 'jsx'],
    ['const value: number = 1{:ts}', 'const value: number = 1', 'ts'],
    ['.root { color: red }{:css}', '.root { color: red }', 'css'],
    ['npm install{:sh}', 'npm install', 'sh'],
    ['{ key: value }{:js}', '{ key: value }', 'js'],
  ])('parses the inline suffix in %s', (value, expectedValue, language) => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value }] }],
    };
    transformMarkdownCode()(tree);
    const paragraph = tree.children[0];
    const code = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;

    expect(code).toMatchObject({
      value: expectedValue,
      data: { hProperties: { className: [`language-${language}`] } },
    });
  });

  it('preserves invalid inline suffixes and applies the default language', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: 'code{:}' }] }],
    };
    transformMarkdownCode()(tree);
    const paragraph = tree.children[0];
    const code = paragraph.type === 'paragraph' ? paragraph.children[0] : undefined;

    expect(code).toMatchObject({
      value: 'code{:}',
      data: { hProperties: { className: ['language-tsx'] } },
    });
  });

  it('does not parse inline suffix syntax inside fenced code', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'code', lang: 'js', value: 'const value = 1{:ts}' }],
    };
    transformMarkdownCode()(tree);

    expect(tree.children[0]).toMatchObject({
      value: 'const value = 1{:ts}',
      data: { hProperties: { className: ['language-js'] } },
    });
  });

  it('ignores invalid standalone fence metadata', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'code', lang: 'tsx', meta: 'title="Example" {2}', value: 'const value = 1;' },
      ],
    };
    transformMarkdownCode()(tree);

    expect(tree.children[0].data?.hProperties).toEqual({
      className: ['language-tsx'],
      dataTitle: 'Example',
    });
  });
});

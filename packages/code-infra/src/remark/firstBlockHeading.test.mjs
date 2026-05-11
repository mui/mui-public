import { describe, it, expect } from 'vitest';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import plugin from './firstBlockHeading.mjs';

/**
 * @param {string} input
 * @param {Parameters<typeof plugin>[0]} [options]
 */
function lint(input, options) {
  const file = remark()
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkGfm)
    .use(plugin, options)
    .processSync(input);
  return file.messages.map((message) => ({
    reason: message.reason,
    line: message.line ?? 0,
  }));
}

/**
 * @param {string} input
 * @param {Parameters<typeof plugin>[0]} [options]
 */
function lintMdx(input, options) {
  const file = remark()
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkGfm)
    .use(remarkMdx)
    .use(plugin, options)
    .processSync(input);
  return file.messages.map((message) => ({
    reason: message.reason,
    line: message.line ?? 0,
  }));
}

describe('remark-lint-mui-first-block-heading', () => {
  it('accepts a document starting with an h1', () => {
    expect(lint(`# Title\n\nSome content.\n`)).toEqual([]);
  });

  it('accepts an h1 after YAML frontmatter', () => {
    expect(lint(`---\nfoo: bar\n---\n\n# Title\n`)).toEqual([]);
  });

  it('flags a paragraph before the h1', () => {
    expect(lint(`Lead paragraph.\n\n# Title\n`)).toHaveLength(1);
  });

  it('flags an h2 as the first block', () => {
    expect(lint(`## Subtitle\n\nContent.\n`)).toHaveLength(1);
  });

  it('flags an empty document', () => {
    expect(lint(``)).toHaveLength(1);
  });

  it('flags a document starting with HTML', () => {
    expect(lint(`<div>Hello</div>\n\n# Title\n`)).toHaveLength(1);
  });

  it('accepts an h1 after a <style> block', () => {
    expect(lint(`<style>.x { color: red; }</style>\n\n# Title\n`)).toEqual([]);
  });

  it('accepts an h1 after a <script> block', () => {
    expect(lint(`<script>var x = 1;</script>\n\n# Title\n`)).toEqual([]);
  });

  it('accepts an h1 after an HTML comment', () => {
    expect(lint(`<!-- a comment -->\n\n# Title\n`)).toEqual([]);
  });

  it('accepts an h1 after frontmatter and a <style> block', () => {
    expect(lint(`---\nfoo: bar\n---\n\n<style>.x{}</style>\n\n# Title\n`)).toEqual([]);
  });

  it('accepts a document with a title in YAML frontmatter', () => {
    expect(lint(`---\ntitle: Hello\n---\n\nSome content.\n`)).toEqual([]);
  });

  it('still flags missing h1 when frontmatterTitle is disabled', () => {
    expect(
      lint(`---\ntitle: Hello\n---\n\nSome content.\n`, { frontMatterTitle: false }),
    ).toHaveLength(1);
  });

  it('accepts an h1 after MDX imports', () => {
    expect(lintMdx(`import Foo from './foo';\n\n# Title\n`)).toEqual([]);
  });

  it('accepts an h1 after an MDX block comment expression', () => {
    expect(lintMdx(`{/* a comment */}\n\n# Title\n`)).toEqual([]);
  });

  it('accepts an h1 after MDX comment + imports', () => {
    expect(lintMdx(`{/* lint disable */}\n\nimport Foo from './foo';\n\n# Title\n`)).toEqual([]);
  });

  it('flags an MDX expression that is not a comment', () => {
    expect(lintMdx(`{value}\n\n# Title\n`)).toHaveLength(1);
  });
});

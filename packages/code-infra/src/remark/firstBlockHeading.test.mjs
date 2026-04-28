import { describe, it, expect } from 'vitest';
import remarkFrontmatter from 'remark-frontmatter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import plugin from './firstBlockHeading.mjs';

/**
 * @param {string} input
 */
function lint(input) {
  const file = remark()
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkGfm)
    .use(plugin)
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
});

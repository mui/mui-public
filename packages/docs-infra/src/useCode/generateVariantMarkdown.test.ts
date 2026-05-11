import { describe, it, expect } from 'vitest';
import { generateVariantMarkdown } from './generateVariantMarkdown';

describe('generateVariantMarkdown', () => {
  it('renders the title as a level-3 heading followed by each file as a fenced code block with the filename as a leading comment', () => {
    const result = generateVariantMarkdown({
      title: 'Example',
      files: [
        { name: 'one.ts', source: 'const one = 1\n' },
        { name: 'two.ts', source: 'const two = 2\n' },
      ],
    });

    expect(result).toMatchInlineSnapshot(`
      "### Example

      \`\`\`ts
      // one.ts

      const one = 1
      \`\`\`

      \`\`\`ts
      // two.ts

      const two = 2
      \`\`\`
      "
    `);
  });

  it('omits the heading when no title is provided', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'one.ts', source: 'const one = 1\n' }],
    });

    expect(result.startsWith('```ts\n// one.ts')).toBe(true);
  });

  it('uses the file extension as the language hint and the matching comment syntax for the filename', () => {
    const result = generateVariantMarkdown({
      files: [
        { name: 'one.ts', source: 'a' },
        { name: 'two.css', source: 'b' },
        { name: 'three.json', source: 'c' },
      ],
    });

    expect(result).toContain('```ts\n// one.ts\n\na\n```');
    expect(result).toContain('```css\n/* two.css */\n\nb\n```');
    expect(result).toContain('```json\nc\n```');
  });

  it('uses an HTML comment for md and html files', () => {
    const result = generateVariantMarkdown({
      files: [
        { name: 'one.md', source: 'a' },
        { name: 'two.html', source: 'b' },
      ],
    });

    expect(result).toContain('```md\n<!-- one.md -->\n\na\n```');
    expect(result).toContain('```html\n<!-- two.html -->\n\nb\n```');
  });

  it('uses an MDX expression comment for mdx files', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'one.mdx', source: 'a' }],
    });

    expect(result).toContain('```mdx\n{/* one.mdx */}\n\na\n```');
  });

  it('omits the language hint and the filename comment when the filename has no extension', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'README', source: 'hello\n' }],
    });

    expect(result).toContain('```\nhello\n```');
  });

  it('omits the filename comment when the language has no supported comment syntax for it', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'data.json', source: '{}\n' }],
    });

    expect(result).toContain('```json\n{}\n```');
  });

  it('expands the fence so backticks inside the source are not escaped', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'one.md', source: '```ts\nconst one = 1\n```\n' }],
    });

    // Fence must be longer than any backtick run inside the body (3 -> 4).
    expect(result).toContain('````md\n<!-- one.md -->\n\n```ts\nconst one = 1\n```\n````');
  });

  it('picks a single fence length that is longer than the longest backtick run across all files', () => {
    const result = generateVariantMarkdown({
      files: [
        { name: 'one.md', source: '`inline`' },
        { name: 'two.md', source: '`````\nfive\n`````' },
        { name: 'three.md', source: '```\nthree\n```' },
      ],
    });

    // Longest run is 5 backticks, so every fence must be 6.
    expect(result).toContain('``````md\n<!-- one.md -->\n\n`inline`\n``````');
    expect(result).toContain('``````md\n<!-- two.md -->\n\n`````\nfive\n`````\n``````');
    expect(result).toContain('``````md\n<!-- three.md -->\n\n```\nthree\n```\n``````');
  });

  it('returns an empty string when there are no files', () => {
    expect(generateVariantMarkdown({ files: [] })).toBe('');
  });
});

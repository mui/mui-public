import { describe, it, expect } from 'vitest';
import { generateVariantMarkdown } from './generateVariantMarkdown';

describe('generateVariantMarkdown', () => {
  it('renders the title as a level-3 heading followed by each file as a bold label and fenced code block with extension language', () => {
    const result = generateVariantMarkdown({
      title: 'Example',
      files: [
        { name: 'one.ts', source: 'const one = 1\n' },
        { name: 'two.ts', source: 'const two = 2\n' },
      ],
    });

    expect(result).toMatchInlineSnapshot(`
      "### Example

      **one.ts**

      \`\`\`ts
      const one = 1
      \`\`\`

      **two.ts**

      \`\`\`ts
      const two = 2
      \`\`\`
      "
    `);
  });

  it('omits the heading when no title is provided', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'one.ts', source: 'const one = 1\n' }],
    });

    expect(result.startsWith('**one.ts**')).toBe(true);
  });

  it('uses the file extension as the language hint', () => {
    const result = generateVariantMarkdown({
      files: [
        { name: 'one.ts', source: 'a' },
        { name: 'two.css', source: 'b' },
        { name: 'three.json', source: 'c' },
      ],
    });

    expect(result).toContain('```ts\na\n```');
    expect(result).toContain('```css\nb\n```');
    expect(result).toContain('```json\nc\n```');
  });

  it('omits the language hint when the filename has no extension', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'README', source: 'hello\n' }],
    });

    expect(result).toContain('```\nhello\n```');
  });

  it('expands the fence so backticks inside the source are not escaped', () => {
    const result = generateVariantMarkdown({
      files: [{ name: 'one.md', source: '```ts\nconst one = 1\n```\n' }],
    });

    // Fence must be longer than any backtick run inside the body (3 -> 4).
    expect(result).toContain('````md\n```ts\nconst one = 1\n```\n````');
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
    expect(result).toContain('``````md\n`inline`\n``````');
    expect(result).toContain('``````md\n`````\nfive\n`````\n``````');
    expect(result).toContain('``````md\n```\nthree\n```\n``````');
  });

  it('returns an empty string when there are no files', () => {
    expect(generateVariantMarkdown({ files: [] })).toBe('');
  });
});

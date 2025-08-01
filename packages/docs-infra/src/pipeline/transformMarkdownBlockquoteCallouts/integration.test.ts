import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { transformMarkdownBlockquoteCallouts } from './transformMarkdownBlockquoteCallouts';

describe('remarkBlockquoteCallouts integration', () => {
  it('should work in a complete pipeline like Next.js MDX', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(transformMarkdownBlockquoteCallouts)
      .use(remarkRehype)
      .use(rehypeStringify);

    const markdown = `
# Test Document

> [!NOTE]
> This is a note callout with **bold text**.

> [!TIP]
> This is a tip with a [link](https://example.com).

> Regular blockquote without callouts.

> [!WARNING]
> Multi-line warning
> 
> With multiple paragraphs.
`;

    const result = await processor.process(markdown);
    const html = result.toString();

    // Check that callouts are processed correctly
    expect(html).toContain('<blockquote data-callout-type="note">');
    expect(html).toContain('<blockquote data-callout-type="tip">');
    expect(html).toContain('<blockquote data-callout-type="warning">');

    // Check that regular blockquote doesn't have data attribute
    expect(html).toContain('<blockquote>\n<p>Regular blockquote');

    // Check that callout markers are removed
    expect(html).not.toContain('[!NOTE]');
    expect(html).not.toContain('[!TIP]');
    expect(html).not.toContain('[!WARNING]');

    // Check that markdown content is still processed
    expect(html).toContain('<strong>bold text</strong>');
    expect(html).toContain('<a href="https://example.com">link</a>');

    // Check that the HTML structure is correct
    expect(html).toContain('<h1>Test Document</h1>');
  });
});

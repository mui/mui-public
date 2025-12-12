import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type { Blockquote } from 'mdast';
import { transformMarkdownBlockquoteCallouts } from './transformMarkdownBlockquoteCallouts';

describe('transformMarkdownBlockquoteCallouts', () => {
  const createProcessor = () => {
    return unified()
      .use(remarkParse)
      .use(transformMarkdownBlockquoteCallouts)
      .use(remarkRehype)
      .use(rehypeStringify);
  };

  const processMarkdown = async (markdown: string) => {
    const processor = createProcessor();
    const result = await processor.process(markdown);
    return result.toString();
  };

  const getAstFromMarkdown = async (markdown: string) => {
    const processor = unified().use(remarkParse).use(transformMarkdownBlockquoteCallouts);
    const tree = await processor.run(processor.parse(markdown));
    return tree as any;
  };

  it('should add data-callout-type attribute for NOTE callout', async () => {
    const markdown = '> [!NOTE]\n> This is a note.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('<p>This is a note.</p>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('should add data-callout-type attribute for TIP callout', async () => {
    const markdown = '> [!TIP]\n> This is a tip.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="tip"');
    expect(html).toContain('<p>This is a tip.</p>');
    expect(html).not.toContain('[!TIP]');
  });

  it('should add data-callout-type attribute for IMPORTANT callout', async () => {
    const markdown = '> [!IMPORTANT]\n> This is important.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="important"');
    expect(html).toContain('<p>This is important.</p>');
    expect(html).not.toContain('[!IMPORTANT]');
  });

  it('should add data-callout-type attribute for WARNING callout', async () => {
    const markdown = '> [!WARNING]\n> This is a warning.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="warning"');
    expect(html).toContain('<p>This is a warning.</p>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('should add data-callout-type attribute for CAUTION callout', async () => {
    const markdown = '> [!CAUTION]\n> This is a caution.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="caution"');
    expect(html).toContain('<p>This is a caution.</p>');
    expect(html).not.toContain('[!CAUTION]');
  });

  it('should handle callouts with extra whitespace', async () => {
    const markdown = '> [!NOTE]   This is a note with extra spaces.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('<p>This is a note with extra spaces.</p>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('should handle callouts on same line as text', async () => {
    const markdown = '> [!NOTE] This is a note on the same line.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('<p>This is a note on the same line.</p>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('should not modify blockquotes without callout markers', async () => {
    const markdown = '> This is a regular blockquote.';
    const html = await processMarkdown(markdown);

    expect(html).not.toContain('data-callout-type');
    expect(html).toContain('<p>This is a regular blockquote.</p>');
  });

  it('should not modify blockquotes with invalid callout types', async () => {
    const markdown = '> [!INVALID] This is an invalid callout.';
    const html = await processMarkdown(markdown);

    expect(html).not.toContain('data-callout-type');
    expect(html).toContain('<p>[!INVALID] This is an invalid callout.</p>');
  });

  it('should handle blockquotes with multiple paragraphs', async () => {
    const markdown = '> [!NOTE] This is a note.\n>\n> This is another paragraph.';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('<p>This is a note.</p>');
    expect(html).toContain('<p>This is another paragraph.</p>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('should handle empty blockquotes', async () => {
    const markdown = '>';
    const html = await processMarkdown(markdown);

    expect(html).not.toContain('data-callout-type');
  });

  it('should handle callouts that make the text node empty', async () => {
    const markdown = '> [!NOTE]';
    const tree = await getAstFromMarkdown(markdown);

    const blockquote = tree.children[0] as Blockquote;
    expect((blockquote.data as any)?.hProperties?.['data-callout-type']).toBe('note');

    // The paragraph should still exist but be empty
    expect(blockquote.children).toHaveLength(1);
    expect(blockquote.children[0].type).toBe('paragraph');
    expect((blockquote.children[0] as any).children).toHaveLength(0);
  });

  it('should preserve other blockquote content when processing callouts', async () => {
    const markdown =
      '> [!NOTE] Important note\n>\n> Additional content\n>\n> - List item\n> - Another item';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('<p>Important note</p>');
    expect(html).toContain('<p>Additional content</p>');
    expect(html).toContain('<li>List item</li>');
    expect(html).toContain('<li>Another item</li>');
    expect(html).not.toContain('[!NOTE]');
  });

  it('should work with nested blockquotes', async () => {
    const markdown = '> [!NOTE] Outer note\n>\n> > [!TIP] Inner tip';
    const html = await processMarkdown(markdown);

    expect(html).toContain('data-callout-type="note"');
    expect(html).toContain('data-callout-type="tip"');
    expect(html).toContain('<p>Outer note</p>');
    expect(html).toContain('<p>Inner tip</p>');
  });
});

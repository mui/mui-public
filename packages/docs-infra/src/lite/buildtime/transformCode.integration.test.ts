import { describe, expect, it } from 'vitest';
import type { Element, Root } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { transformMarkdownCode } from './transformMarkdownCode';
import { transformHtmlCode } from './transformHtmlCode';

describe('lite MDX code pipeline', () => {
  it('transforms realistic Markdown fences and inline code', async () => {
    const markdown = [
      'Use `string` in this example.',
      '',
      '```tsx title="Example"',
      'const value = true; // @highlight',
      '```',
    ].join('\n');
    const processor = unified()
      .use(remarkParse)
      .use(transformMarkdownCode)
      .use(remarkRehype)
      .use(transformHtmlCode);
    const tree = (await processor.run(processor.parse(markdown))) as Root;
    const paragraph = tree.children[0] as Element;
    const inlineCode = paragraph.children.find(
      (child): child is Element => child.type === 'element' && child.tagName === 'code',
    );
    const pre = tree.children.find(
      (child): child is Element => child.type === 'element' && child.tagName === 'pre',
    );

    expect(inlineCode?.properties.dataInline).toBe('');
    expect(JSON.stringify(inlineCode)).toContain('pl-bt');
    expect(pre?.properties.dataContentProps).toBe('{"title":"Example"}');
    const precompute = JSON.parse(String(pre?.properties.dataPrecompute));
    expect(precompute.Default.language).toBe('tsx');
    expect(JSON.stringify(precompute.Default.source)).toContain('dataHl');
    expect(JSON.stringify(precompute.Default.source)).not.toContain('@highlight');
  });
});

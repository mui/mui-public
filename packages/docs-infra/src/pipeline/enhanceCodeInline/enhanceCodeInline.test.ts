import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import enhanceCodeInline from './enhanceCodeInline';

describe('enhanceCodeInline', () => {
  /**
   * Helper function to process HTML string through the plugin.
   * Parses HTML → applies enhancement → serializes back to HTML.
   */
  async function processHtml(input: string): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(enhanceCodeInline)
      .use(rehypeStringify)
      .process(input);

    return String(result);
  }

  describe('entity tag enhancement (pl-ent)', () => {
    it('wraps < and > around pl-ent span in a di-ht wrapper', async () => {
      const input =
        '<code class="Code language-tsx">&lt;<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="Code language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">div</span>></span></code>',
      );
    });

    it('handles multiple entity tags in sequence', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span>&gt;&lt;<span class="pl-ent">span</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">div</span>></span><span class="di-ht">&#x3C;<span class="pl-ent">span</span>></span></code>',
      );
    });

    it('handles self-closing tags with space', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-ent">br</span> /&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">br</span> /></span></code>',
      );
    });

    it('handles self-closing tags without space', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-ent">input</span>/&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">input</span>/></span></code>',
      );
    });

    it('handles tags with attributes', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1 di-jsx">Box</span> flag option={true} /&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span> flag option={true} /></span></code>',
      );
    });

    it('handles tags with simple attributes and normal close', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span> className="test"&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">div</span> className="test"></span></code>',
      );
    });

    it('handles closing tags', async () => {
      const input = '<code class="language-tsx">&lt;/<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;/<span class="pl-ent">div</span>></span></code>',
      );
    });

    it('wraps tag with highlighted attribute spans between tag name and closing bracket', async () => {
      const input =
        '<code class="language-tsx" data-inline="">&lt;<span class="pl-ent">div</span> <span class="pl-e di-ak">className</span><span class="pl-k di-ae">=</span><span class="pl-s di-av"><span class="pl-pds">"</span>x<span class="pl-pds">"</span></span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx" data-inline=""><span class="di-ht">&#x3C;<span class="pl-ent">div</span> <span class="pl-e di-ak">className</span><span class="pl-k di-ae">=</span><span class="pl-s di-av"><span class="pl-pds">"</span>x<span class="pl-pds">"</span></span>></span></code>',
      );
    });

    it('skips > in the middle of intermediate text and wraps at the real tag close', async () => {
      // An intermediate text node with ">" in the middle (not at start or end)
      // is not a tag-close token. The scan skips it and finds the real close.
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span> a&gt;b &gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">div</span> a>b ></span></code>',
      );
    });
  });

  describe('syntax constant enhancement (pl-c1)', () => {
    it('wraps < and > around pl-c1 span in a di-jt wrapper', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1 di-jsx">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span>></span></code>',
      );
    });

    it('handles multiple syntax constants in sequence', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1 di-jsx">Box</span>&gt;&lt;<span class="pl-c1 di-jsx">Stack</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span>></span><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Stack</span>></span></code>',
      );
    });

    it('handles closing tags with pl-c1', async () => {
      const input =
        '<code class="language-tsx">&lt;/<span class="pl-c1 di-jsx">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;/<span class="pl-c1 di-jsx">Box</span>></span></code>',
      );
    });
  });

  describe('mixed scenarios', () => {
    it('handles pl-ent and pl-c1 in the same code element', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span>&gt;&lt;<span class="pl-c1 di-jsx">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;<span class="pl-ent">div</span>></span><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span>></span></code>',
      );
    });

    it('preserves other content around enhanced elements', async () => {
      const input =
        '<code class="language-tsx">const x = &lt;<span class="pl-c1 di-jsx">Box</span>&gt;;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx">const x = <span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span>></span>;</code>',
      );
    });

    it('preserves other spans without pl-ent or pl-c1 classes', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-k">const</span> &lt;<span class="pl-c1 di-jsx">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-k">const</span> <span class="di-jt">&#x3C;<span class="pl-c1 di-jsx">Box</span>></span></code>',
      );
    });
  });

  describe('edge cases', () => {
    it('does not modify code elements inside pre elements', async () => {
      const input =
        '<pre><code class="language-tsx">&lt;<span class="pl-ent">div</span>&gt;</code></pre>';

      const output = await processHtml(input);

      // Should remain unchanged
      expect(output).toBe(
        '<pre><code class="language-tsx">&#x3C;<span class="pl-ent">div</span>></code></pre>',
      );
    });

    it('does not modify spans without matching < prefix', async () => {
      const input = '<code class="language-tsx"><span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      // Should remain unchanged - no < before the span
      expect(output).toBe('<code class="language-tsx"><span class="pl-ent">div</span>></code>');
    });

    it('does not modify spans without matching > suffix', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-ent">div</span></code>';

      const output = await processHtml(input);

      // Should remain unchanged - no > after the span
      expect(output).toBe(
        '<code class="language-tsx">&#x3C;<span class="pl-ent">div</span></code>',
      );
    });

    it('handles code elements without language class', async () => {
      const input = '<code>&lt;<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code><span class="di-ht">&#x3C;<span class="pl-ent">div</span>></span></code>',
      );
    });

    it('handles empty code elements', async () => {
      const input = '<code class="language-tsx"></code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-tsx"></code>');
    });

    it('handles code elements with only text', async () => {
      const input = '<code class="language-tsx">plain text</code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-tsx">plain text</code>');
    });

    it('handles nested spans within pl-ent/pl-c1', async () => {
      // Unlikely scenario but should be handled gracefully
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1 di-jsx"><span class="inner">Box</span></span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;<span class="pl-c1 di-jsx"><span class="inner">Box</span></span>></span></code>',
      );
    });
  });

  describe('attribute preservation', () => {
    it('preserves all classes on the span element', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent custom-class">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toContain('class="pl-ent custom-class"');
      expect(output).toContain('class="di-ht"');
    });

    it('preserves other attributes on the span element', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent" data-test="value">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toContain('data-test="value"');
    });

    it('preserves all classes on the code element', async () => {
      const input =
        '<code class="Code language-tsx custom">&lt;<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toContain('class="Code language-tsx custom"');
    });
  });

  describe('normalized standalone closing tags (text brackets)', () => {
    it('wraps closing JSX component tag (pl-c1 di-jsx with text brackets) as di-jt', async () => {
      // After extendSyntaxTokens: pl-k("</") → text("</"), pl-smi → pl-c1 + di-jsx
      const input =
        '<code class="language-tsx">&lt;/<span class="pl-c1 di-jsx">Stack</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-jt">&#x3C;/<span class="pl-c1 di-jsx">Stack</span>></span></code>',
      );
    });

    it('wraps closing HTML element tag (pl-ent with text brackets) as di-ht', async () => {
      // After extendSyntaxTokens: pl-k("</") → text("</"), pl-smi → pl-ent
      const input = '<code class="language-tsx">&lt;/<span class="pl-ent">span</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="di-ht">&#x3C;/<span class="pl-ent">span</span>></span></code>',
      );
    });

    it('does not wrap spans with no tag-name class (pl-k brackets pass through)', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-k">&lt;</span><span class="pl-v">foo</span><span class="pl-k">&gt;</span></code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-k">&#x3C;</span><span class="pl-v">foo</span><span class="pl-k">></span></code>',
      );
    });

    it('does not wrap pl-smi with opening bracket (not a tag name)', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-k">&lt;</span><span class="pl-smi">x</span><span class="pl-k">&gt;</span></code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-k">&#x3C;</span><span class="pl-smi">x</span><span class="pl-k">></span></code>',
      );
    });
  });

  describe('token reclassification', () => {
    it('reclassifies pl-en "function" to pl-k', async () => {
      const input = '<code class="language-ts"><span class="pl-en">function</span></code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-ts"><span class="pl-k">function</span></code>');
    });

    it('does not reclassify pl-en spans with other text', async () => {
      const input = '<code class="language-ts"><span class="pl-en">myFunction</span></code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-ts"><span class="pl-en">myFunction</span></code>');
    });

    it('does not reclassify "function" in other classes', async () => {
      const input = '<code class="language-ts"><span class="pl-c1">function</span></code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-ts"><span class="pl-c1">function</span></code>');
    });

    it('does not reclassify inside pre elements', async () => {
      const input =
        '<pre><code class="language-ts"><span class="pl-en">function</span></code></pre>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<pre><code class="language-ts"><span class="pl-en">function</span></code></pre>',
      );
    });
  });
});

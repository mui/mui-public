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
    it('wraps < and > around pl-ent span into the span', async () => {
      const input =
        '<code class="Code language-tsx">&lt;<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="Code language-tsx"><span class="pl-ent">&#x3C;div></span></code>',
      );
    });

    it('handles multiple entity tags in sequence', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span>&gt;&lt;<span class="pl-ent">span</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;div></span><span class="pl-ent">&#x3C;span></span></code>',
      );
    });

    it('handles self-closing tags with space', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-ent">br</span> /&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;br /></span></code>',
      );
    });

    it('handles self-closing tags without space', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-ent">input</span>/&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;input/></span></code>',
      );
    });

    it('handles tags with attributes', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1">Box</span> flag option={true} /&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">&#x3C;Box flag option={true} /></span></code>',
      );
    });

    it('handles tags with simple attributes and normal close', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span> className="test"&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;div className="test"></span></code>',
      );
    });

    it('handles closing tags', async () => {
      const input = '<code class="language-tsx">&lt;/<span class="pl-ent">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;/div></span></code>',
      );
    });
  });

  describe('syntax constant enhancement (pl-c1)', () => {
    it('wraps < and > around pl-c1 span into the span', async () => {
      const input = '<code class="language-tsx">&lt;<span class="pl-c1">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">&#x3C;Box></span></code>',
      );
    });

    it('handles multiple syntax constants in sequence', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-c1">Box</span>&gt;&lt;<span class="pl-c1">Stack</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">&#x3C;Box></span><span class="pl-c1">&#x3C;Stack></span></code>',
      );
    });

    it('handles closing tags with pl-c1', async () => {
      const input = '<code class="language-tsx">&lt;/<span class="pl-c1">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">&#x3C;/Box></span></code>',
      );
    });
  });

  describe('mixed scenarios', () => {
    it('handles pl-ent and pl-c1 in the same code element', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent">div</span>&gt;&lt;<span class="pl-c1">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-ent">&#x3C;div></span><span class="pl-c1">&#x3C;Box></span></code>',
      );
    });

    it('preserves other content around enhanced elements', async () => {
      const input =
        '<code class="language-tsx">const x = &lt;<span class="pl-c1">Box</span>&gt;;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx">const x = <span class="pl-c1">&#x3C;Box></span>;</code>',
      );
    });

    it('preserves other spans without pl-ent or pl-c1 classes', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-k">const</span> &lt;<span class="pl-c1">Box</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">&#x3C;Box></span></code>',
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

      expect(output).toBe('<code><span class="pl-ent">&#x3C;div></span></code>');
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
        '<code class="language-tsx">&lt;<span class="pl-c1"><span class="inner">Box</span></span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">&#x3C;<span class="inner">Box</span>></span></code>',
      );
    });
  });

  describe('attribute preservation', () => {
    it('preserves all classes on the span element', async () => {
      const input =
        '<code class="language-tsx">&lt;<span class="pl-ent custom-class">div</span>&gt;</code>';

      const output = await processHtml(input);

      expect(output).toContain('class="pl-ent custom-class"');
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
});

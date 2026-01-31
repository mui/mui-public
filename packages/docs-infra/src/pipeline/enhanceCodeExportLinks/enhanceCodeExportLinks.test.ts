import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import enhanceCodeExportLinks from './enhanceCodeExportLinks';

describe('enhanceCodeExportLinks', () => {
  /**
   * Helper function to process HTML string through the plugin.
   * Parses HTML → applies enhancement → serializes back to HTML.
   */
  async function processHtml(input: string, anchorMap: Record<string, string>): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(enhanceCodeExportLinks, { anchorMap })
      .use(rehypeStringify)
      .process(input);

    return String(result);
  }

  describe('single pl-c1 span linking', () => {
    it('converts a single matching pl-c1 span to an anchor', async () => {
      const input = '<code><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><a href="#trigger" class="pl-c1">Trigger</a></code>');
    });

    it('does not modify a non-matching pl-c1 span', async () => {
      const input = '<code><span class="pl-c1">Unknown</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><span class="pl-c1">Unknown</span></code>');
    });

    it('is case-sensitive when matching', async () => {
      const input = '<code><span class="pl-c1">trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      // Should not match - case differs
      expect(output).toBe('<code><span class="pl-c1">trigger</span></code>');
    });

    it('handles flat name that maps to dotted anchor', async () => {
      const input = '<code><span class="pl-c1">AccordionTrigger</span></code>';
      const anchorMap = { AccordionTrigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><a href="#trigger" class="pl-c1">AccordionTrigger</a></code>');
    });

    it('preserves other content around the linked span', async () => {
      const input = '<code>The <span class="pl-c1">Trigger</span> component</code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code>The <a href="#trigger" class="pl-c1">Trigger</a> component</code>',
      );
    });
  });

  describe('dotted chain linking', () => {
    it('wraps a two-part dotted chain in an anchor', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a></code>',
      );
    });

    it('wraps a three-part dotted chain in an anchor', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const anchorMap = { 'Accordion.Trigger.State': '#trigger.state' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#trigger.state"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></a></code>',
      );
    });

    it('does not link a chain that does not match', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>',
      );
    });

    it('only matches exact chains, not partial', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, anchorMap);

      // Full chain "Accordion.Trigger.State" doesn't match, so no linking
      expect(output).toBe(
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>',
      );
    });
  });

  describe('multiple matches in same code element', () => {
    it('links multiple separate pl-c1 spans', async () => {
      const input =
        '<code><span class="pl-c1">Trigger</span> and <span class="pl-c1">Root</span></code>';
      const anchorMap = { Trigger: '#trigger', Root: '#root' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#trigger" class="pl-c1">Trigger</a> and <a href="#root" class="pl-c1">Root</a></code>',
      );
    });

    it('links a chain and a single span in the same code element', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span> or <span class="pl-c1">Root</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger', Root: '#root' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a> or <a href="#root" class="pl-c1">Root</a></code>',
      );
    });
  });

  describe('edge cases', () => {
    it('processes code inside pre elements (block code)', async () => {
      const input = '<pre><code><span class="pl-c1">Trigger</span></code></pre>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      // Should link the span
      expect(output).toBe('<pre><code><a href="#trigger" class="pl-c1">Trigger</a></code></pre>');
    });

    it('ignores spans without pl-c1 class', async () => {
      const input = '<code><span class="pl-ent">div</span></code>';
      const anchorMap = { div: '#div' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><span class="pl-ent">div</span></code>');
    });

    it('handles empty anchorMap gracefully', async () => {
      const input = '<code><span class="pl-c1">Trigger</span></code>';
      const anchorMap = {};

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><span class="pl-c1">Trigger</span></code>');
    });

    it('handles code element with no children', async () => {
      const input = '<code></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code></code>');
    });

    it('handles non-consecutive pl-c1 spans as separate matches', async () => {
      // There's text between the spans, not just a dot
      const input =
        '<code><span class="pl-c1">Accordion</span> <span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Accordion: '#accordion', Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#accordion" class="pl-c1">Accordion</a> <a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('does not form chain when text between spans is not just a dot', async () => {
      const input =
        '<code><span class="pl-c1">Accordion</span>: <span class="pl-c1">Trigger</span></code>';
      const anchorMap = {
        'Accordion.Trigger': '#trigger',
        Accordion: '#accordion',
        Trigger: '#trigger-standalone',
      };

      const output = await processHtml(input, anchorMap);

      // Should match as separate spans, not a chain
      expect(output).toBe(
        '<code><a href="#accordion" class="pl-c1">Accordion</a>: <a href="#trigger-standalone" class="pl-c1">Trigger</a></code>',
      );
    });
  });

  describe('pl-en class support (type names)', () => {
    it('converts a single matching pl-en span to an anchor', async () => {
      const input = '<code><span class="pl-en">InputType</span></code>';
      const anchorMap = { InputType: '#inputtype' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><a href="#inputtype" class="pl-en">InputType</a></code>');
    });

    it('wraps a dotted chain of pl-en spans in an anchor', async () => {
      const input =
        '<code><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></code>';
      const anchorMap = { 'Accordion.Root': '#root' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#root"><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></a></code>',
      );
    });

    it('handles mixed pl-c1 and pl-en spans in a chain', async () => {
      // In practice this is unlikely, but should work
      const input =
        '<code><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></a></code>',
      );
    });

    it('links multiple pl-en spans separately', async () => {
      const input =
        '<code><span class="pl-en">InputType</span> and <span class="pl-en">OutputType</span></code>';
      const anchorMap = { InputType: '#inputtype', OutputType: '#outputtype' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><a href="#inputtype" class="pl-en">InputType</a> and <a href="#outputtype" class="pl-en">OutputType</a></code>',
      );
    });
  });

  describe('nested structure support (frame/line spans)', () => {
    it('links spans inside nested line elements', async () => {
      const input =
        '<code class="language-ts"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const anchorMap = { 'Component.Root': '#root' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code class="language-ts"><span class="frame"><span class="line"><a href="#root"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></a></span></span></code>',
      );
    });

    it('links a three-part chain inside nested elements', async () => {
      const input =
        '<code><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></span></span></code>';
      const anchorMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><span class="frame"><span class="line"><a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a></span></span></code>',
      );
    });

    it('handles complex nested structure with other content', async () => {
      // Mimics real output: | ((details: Component.Root.ChangeEventDetails) => void)
      const input =
        '<code class="language-ts"><span class="frame"><span class="line" data-ln="1"><span class="pl-k">|</span> ((<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span>)</span></span></code>';
      const anchorMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, anchorMap);

      expect(output).toContain(
        '<a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a>',
      );
    });

    it('links multiple separate matches in deeply nested structure', async () => {
      const input =
        '<code><span class="frame"><span class="line"><span class="pl-en">TypeA</span> and <span class="pl-en">TypeB</span></span></span></code>';
      const anchorMap = { TypeA: '#typea', TypeB: '#typeb' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe(
        '<code><span class="frame"><span class="line"><a href="#typea" class="pl-en">TypeA</a> and <a href="#typeb" class="pl-en">TypeB</a></span></span></code>',
      );
    });

    it('does not create nested anchors when processing already-linked content', async () => {
      // If an anchor already exists with a linkable class, it should NOT be wrapped again
      const input = '<code><a href="#trigger" class="pl-en">Trigger</a></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      // Should remain unchanged - no nested anchors
      expect(output).toBe('<code><a href="#trigger" class="pl-en">Trigger</a></code>');
    });
  });
});

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
  async function processHtml(
    input: string,
    anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
  ): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(enhanceCodeExportLinks, { anchorMap })
      .use(rehypeStringify)
      .process(input);

    return String(result);
  }

  describe('single pl-c1 span linking', () => {
    it('converts a single matching pl-c1 span to an anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('does not modify a non-matching pl-c1 span', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Unknown</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Unknown</span></code>');
    });

    it('is case-sensitive when matching', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      // Should not match - case differs
      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">trigger</span></code>');
    });

    it('handles flat name that maps to dotted anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">AccordionTrigger</span></code>';
      const anchorMap = { AccordionTrigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">AccordionTrigger</a></code>',
      );
    });

    it('preserves other content around the linked span', async () => {
      const input =
        '<code class="language-tsx">The <span class="pl-c1">Trigger</span> component</code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx">The <a href="#trigger" class="pl-c1">Trigger</a> component</code>',
      );
    });
  });

  describe('dotted chain linking', () => {
    it('wraps a two-part dotted chain in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a></code>',
      );
    });

    it('wraps a three-part dotted chain in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const anchorMap = { 'Accordion.Trigger.State': '#trigger.state' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger.state"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></a></code>',
      );
    });

    it('does not link a chain that does not match', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>',
      );
    });

    it('only matches exact chains, not partial', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      // Full chain "Accordion.Trigger.State" doesn't match, so no linking
      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>',
      );
    });
  });

  describe('multiple matches in same code element', () => {
    it('links multiple separate pl-c1 spans', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Trigger</span> and <span class="pl-c1">Root</span></code>';
      const anchorMap = { Trigger: '#trigger', Root: '#root' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a> and <a href="#root" class="pl-c1">Root</a></code>',
      );
    });

    it('links a chain and a single span in the same code element', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span> or <span class="pl-c1">Root</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger', Root: '#root' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a> or <a href="#root" class="pl-c1">Root</a></code>',
      );
    });
  });

  describe('edge cases', () => {
    it('processes code inside pre elements (block code)', async () => {
      const input =
        '<pre><code class="language-tsx"><span class="pl-c1">Trigger</span></code></pre>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      // Should link the span
      expect(output).toBe(
        '<pre><code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code></pre>',
      );
    });

    it('ignores spans without pl-c1 class', async () => {
      const input = '<code class="language-tsx"><span class="pl-ent">div</span></code>';
      const anchorMap = { div: '#div' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-ent">div</span></code>');
    });

    it('handles empty anchorMap gracefully', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const anchorMap = {};

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Trigger</span></code>');
    });

    it('handles code element with no children', async () => {
      const input = '<code class="language-tsx"></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe('<code class="language-tsx"></code>');
    });

    it('handles non-consecutive pl-c1 spans as separate matches', async () => {
      // There's text between the spans, not just a dot
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span> <span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Accordion: '#accordion', Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#accordion" class="pl-c1">Accordion</a> <a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('does not form chain when text between spans is not just a dot', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>: <span class="pl-c1">Trigger</span></code>';
      const anchorMap = {
        'Accordion.Trigger': '#trigger',
        Accordion: '#accordion',
        Trigger: '#trigger-standalone',
      };

      const output = await processHtml(input, { js: anchorMap });

      // Should match as separate spans, not a chain
      expect(output).toBe(
        '<code class="language-tsx"><a href="#accordion" class="pl-c1">Accordion</a>: <a href="#trigger-standalone" class="pl-c1">Trigger</a></code>',
      );
    });
  });

  describe('pl-en class support (type names)', () => {
    it('converts a single matching pl-en span to an anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-en">InputType</span></code>';
      const anchorMap = { InputType: '#inputtype' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#inputtype" class="pl-en">InputType</a></code>',
      );
    });

    it('wraps a dotted chain of pl-en spans in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></code>';
      const anchorMap = { 'Accordion.Root': '#root' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#root"><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></a></code>',
      );
    });

    it('handles mixed pl-c1 and pl-en spans in a chain', async () => {
      // In practice this is unlikely, but should work
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></a></code>',
      );
    });

    it('links multiple pl-en spans separately', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">InputType</span> and <span class="pl-en">OutputType</span></code>';
      const anchorMap = { InputType: '#inputtype', OutputType: '#outputtype' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#inputtype" class="pl-en">InputType</a> and <a href="#outputtype" class="pl-en">OutputType</a></code>',
      );
    });
  });

  describe('nested structure support (frame/line spans)', () => {
    it('links spans inside nested line elements', async () => {
      const input =
        '<code class="language-ts"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const anchorMap = { 'Component.Root': '#root' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-ts"><span class="frame"><span class="line"><a href="#root"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></a></span></span></code>',
      );
    });

    it('links a three-part chain inside nested elements', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></span></span></code>';
      const anchorMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="frame"><span class="line"><a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a></span></span></code>',
      );
    });

    it('handles complex nested structure with other content', async () => {
      // Mimics real output: | ((details: Component.Root.ChangeEventDetails) => void)
      const input =
        '<code class="language-ts"><span class="frame"><span class="line" data-ln="1"><span class="pl-k">|</span> ((<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span>)</span></span></code>';
      const anchorMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toContain(
        '<a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a>',
      );
    });

    it('links multiple separate matches in deeply nested structure', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">TypeA</span> and <span class="pl-en">TypeB</span></span></span></code>';
      const anchorMap = { TypeA: '#typea', TypeB: '#typeb' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="frame"><span class="line"><a href="#typea" class="pl-en">TypeA</a> and <a href="#typeb" class="pl-en">TypeB</a></span></span></code>',
      );
    });

    it('does not create nested anchors when processing already-linked content', async () => {
      // If an anchor already exists with a linkable class, it should NOT be wrapped again
      const input =
        '<code class="language-tsx"><a href="#trigger" class="pl-en">Trigger</a></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      // Should remain unchanged - no nested anchors
      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-en">Trigger</a></code>',
      );
    });
  });

  describe('typeRefComponent option', () => {
    async function processHtmlWithTypeRef(
      input: string,
      anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
      typeRefComponent: string,
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeExportLinks, { anchorMap, typeRefComponent })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    it('emits a custom component element instead of an anchor for a single span', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: anchorMap }, 'TypeRef');

      expect(output).toBe(
        '<code class="language-tsx"><TypeRef href="#trigger" name="Trigger" class="pl-c1">Trigger</TypeRef></code>',
      );
    });

    it('emits a custom component element for a dotted chain', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: anchorMap }, 'TypeRef');

      expect(output).toBe(
        '<code class="language-tsx"><TypeRef href="#trigger" name="Accordion.Trigger"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></TypeRef></code>',
      );
    });

    it('still falls back to no linking when identifier is not in anchorMap', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Unknown</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: anchorMap }, 'TypeRef');

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Unknown</span></code>');
    });

    it('uses standard anchor when typeRefComponent is not set', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: anchorMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('emits custom elements in nested structures', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const anchorMap = { 'Component.Root': '#root' };

      const output = await processHtmlWithTypeRef(input, { js: anchorMap }, 'TypeRef');

      expect(output).toBe(
        '<code class="language-tsx"><span class="frame"><span class="line"><TypeRef href="#root" name="Component.Root"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></TypeRef></span></span></code>',
      );
    });
  });

  describe('linkProps option', () => {
    /**
     * Helper to process HTML with linkProps enabled.
     */
    async function processWithLinkProps(
      input: string,
      anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
      linkProps: 'shallow' | 'deep',
      opts?: { typePropRefComponent?: string; typeRefComponent?: string },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeExportLinks, { anchorMap, linkProps, ...opts })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('type definition properties (pl-v spans)', () => {
      it('wraps pl-v property names with id spans (definitions)', async () => {
        // Matches starry-night output for: type Item = { label: string; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('wraps multiple pl-v properties', async () => {
        // type Item = { label: string; count: number; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
        expect(output).toContain(
          '<span id="item:count" data-name="Item" data-prop="count" class="pl-v">count</span>',
        );
      });

      it('also links the type name as a type ref', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // Type name linked as export ref (existing behavior)
        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        // Property wrapped as definition (id, not href)
        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('wraps optional pl-v properties (question mark before colon)', async () => {
        // type Item = { label?: string; count?: number; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span>?<span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span>?<span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
        expect(output).toContain(
          '<span id="item:count" data-name="Item" data-prop="count" class="pl-v">count</span>',
        );
      });

      it('wraps optional properties when ?: is a single pl-k token', async () => {
        // Some highlighters may emit "?:" as a single keyword token
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">?:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('does not wrap properties when owner is not in anchorMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // Property should NOT be linked
        expect(output).toContain('<span class="pl-v">label</span>');
        expect(output).not.toContain('href="#');
      });
    });

    describe('object literal properties (plain text)', () => {
      it('wraps plain text property names before colons', async () => {
        // Matches starry-night output for: const item: Item = { label: "hello" };
        // Note: in object literals, property names are plain text (not in spans)
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
      });

      it('wraps multiple plain text properties', async () => {
        // const item: Item = { label: "hello", count: 5 };
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span>, count: <span class="pl-c1">5</span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
        expect(output).toContain(
          '<a href="#item:count" data-name="Item" data-prop="count">count</a>',
        );
      });

      it('does not wrap property when type annotation is not in anchorMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).not.toContain('<a href=');
      });

      it('links properties when type annotation is a dotted chain', async () => {
        // const props: Accordion.Root.Props = { label: 'test' };
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">props</span><span class="pl-k">:</span> <span class="pl-en">Accordion</span>.<span class="pl-en">Root</span>.<span class="pl-en">Props</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>test<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { 'Accordion.Root.Props': '#root.props' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#root.props:label" data-name="Accordion.Root.Props" data-prop="label">label</a>',
        );
      });
    });

    describe('function call properties (plain text)', () => {
      it('wraps properties in function call object arguments', async () => {
        // Matches starry-night output for: makeItem({ label: "hello" });
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('also links the function name as a type ref', async () => {
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // Function name is linked as a type ref
        expect(output).toContain('<a href="#make-item" class="pl-en">makeItem</a>');
        // Property is also linked
        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('links second parameter properties with index in href', async () => {
        // makeItem(someArg, { label: "hello" })
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>(<span class="pl-c1">someArg</span>, { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:1:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('links properties of multiple object parameters with correct indices', async () => {
        // makeItem({ name: "a" }, { label: "b" })
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ name: <span class="pl-s"><span class="pl-pds">"</span>a<span class="pl-pds">"</span></span> }, { label: <span class="pl-s"><span class="pl-pds">"</span>b<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // First object (param 0) — zero omitted in href
        expect(output).toContain(
          '<a href="#make-item::name" data-name="makeItem" data-prop="name">name</a>',
        );
        // Second object (param 1)
        expect(output).toContain(
          '<a href="#make-item:1:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });
    });

    describe('function call — not in anchorMap', () => {
      it('does not wrap properties when function is not in anchorMap', async () => {
        const input =
          '<code class="language-js"><span class="pl-en">unknownFn</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).not.toContain('<a href=');
        expect(output).not.toContain('<span id=');
        expect(output).toContain('label');
      });
    });

    describe('named parameter anchors (anchorMap[name[N]])', () => {
      it('uses named param anchor as base href when available', async () => {
        // makeItem({ label: "hello" }) with makeItem[0] providing a named base
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:props:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('falls back to index-based href when named param anchor is missing', async () => {
        // makeItem({ label: "hello" }) without makeItem[0] in anchorMap
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for non-zero parameter indices', async () => {
        // makeItem(someArg, { label: "hello" }) with makeItem[1] providing a named base
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>(<span class="pl-c1">someArg</span>, { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[1]': '#make-item:options' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:options:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for JSX component props', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card', 'Card[0]': '#card:props' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card:props:label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('falls back to index-based href for JSX when named anchor is missing', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('uses named param anchor with deep nested property paths', async () => {
        // type equivalent with function call: makeItem({ details: { label: "hello" } })
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ details: { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> } });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'deep');

        expect(output).toContain(
          '<a href="#make-item:props:details" data-name="makeItem" data-prop="details">details</a>',
        );
        expect(output).toContain(
          '<a href="#make-item:props:details.label" data-name="makeItem" data-prop="details.label">label</a>',
        );
      });
    });

    describe('JSX component properties (pl-e spans)', () => {
      it('wraps pl-e attribute names with anchors', async () => {
        // Matches starry-night output for: <Card label="hello" />
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('wraps multiple JSX attributes', async () => {
        // <Card label="hello" count={5} />
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> <span class="pl-e">count</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-c1">5</span><span class="pl-pse">}</span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
        expect(output).toContain(
          '<a href="#card::count" data-name="Card" data-prop="count" class="pl-e">count</a>',
        );
      });

      it('does not wrap attributes when component is not in anchorMap', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Unknown</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain('<span class="pl-e">label</span>');
      });
    });

    describe('nested objects (linkProps: deep)', () => {
      it('links nested property with dotted path', async () => {
        // type Item = { details: { label: string; }; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'deep');

        expect(output).toContain(
          '<span id="item:details" data-name="Item" data-prop="details" class="pl-v">details</span>',
        );
        expect(output).toContain(
          '<span id="item:details.label" data-name="Item" data-prop="details.label" class="pl-v">label</span>',
        );
      });

      it('does not link nested properties in shallow mode', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // Top-level property should be defined (id)
        expect(output).toContain(
          '<span id="item:details" data-name="Item" data-prop="details" class="pl-v">details</span>',
        );
        // Nested property should NOT be linked
        expect(output).toContain('<span class="pl-v">label</span>');
      });

      it('handles multiple levels of nesting', async () => {
        // type Item = { a: { b: { c: string; }; }; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">a</span><span class="pl-k">:</span> { <span class="pl-v">b</span><span class="pl-k">:</span> { <span class="pl-v">c</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'deep');

        expect(output).toContain(
          '<span id="item:a" data-name="Item" data-prop="a" class="pl-v">a</span>',
        );
        expect(output).toContain(
          '<span id="item:a.b" data-name="Item" data-prop="a.b" class="pl-v">b</span>',
        );
        expect(output).toContain(
          '<span id="item:a.b.c" data-name="Item" data-prop="a.b.c" class="pl-v">c</span>',
        );
      });

      it('pops nested context when brace closes', async () => {
        // type Item = { details: { label: string; }; count: number; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'deep');

        expect(output).toContain(
          '<span id="item:details" data-name="Item" data-prop="details" class="pl-v">details</span>',
        );
        expect(output).toContain(
          '<span id="item:details.label" data-name="Item" data-prop="details.label" class="pl-v">label</span>',
        );
        // count is back at top level, not nested under details
        expect(output).toContain(
          '<span id="item:count" data-name="Item" data-prop="count" class="pl-v">count</span>',
        );
      });
    });

    describe('kebab-case conversion', () => {
      it('converts camelCase property names to kebab-case in id (type def)', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">firstName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:first-name" data-name="Item" data-prop="first-name" class="pl-v">firstName</span>',
        );
      });

      it('converts each segment of nested path independently', async () => {
        // type Item = { homeAddress: { streetName: string; }; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">homeAddress</span><span class="pl-k">:</span> { <span class="pl-v">streetName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'deep');

        expect(output).toContain(
          '<span id="item:home-address" data-name="Item" data-prop="home-address" class="pl-v">homeAddress</span>',
        );
        expect(output).toContain(
          '<span id="item:home-address.street-name" data-name="Item" data-prop="home-address.street-name" class="pl-v">streetName</span>',
        );
      });
    });

    describe('typePropRefComponent option', () => {
      it('emits custom element with id for type-def span props (definition)', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef id="item:label" name="Item" prop="label" class="pl-v">label</TypePropRef>',
        );
      });

      it('emits custom element for plain text props', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#item:label" name="Item" prop="label">label</TypePropRef>',
        );
      });

      it('emits custom element for JSX pl-e props', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#card::label" name="Card" prop="label" class="pl-e">label</TypePropRef>',
        );
      });

      it('applies kebab-case to prop attribute', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">firstName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef id="item:first-name" name="Item" prop="first-name" class="pl-v">firstName</TypePropRef>',
        );
      });
    });

    describe('combined typeRefComponent and typePropRefComponent', () => {
      it('uses typeRefComponent for type names and typePropRefComponent for props', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typeRefComponent: 'TypeRef',
          typePropRefComponent: 'TypePropRef',
        });

        // Type name uses TypeRef
        expect(output).toContain('<TypeRef href="#item" name="Item" class="pl-en">Item</TypeRef>');
        // Property uses TypePropRef with id (definition site)
        expect(output).toContain(
          '<TypePropRef id="item:label" name="Item" prop="label" class="pl-v">label</TypePropRef>',
        );
      });
    });

    describe('backward compatibility', () => {
      it('does not link properties when linkProps is not set', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processHtml(input, { js: anchorMap });

        // Type name should still be linked
        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        // Property should NOT be linked
        expect(output).toContain('<span class="pl-v">label</span>');
      });
    });

    describe('state across nested frame/line elements', () => {
      it('carries owner context across line boundaries', async () => {
        // Multiline type definition wrapped in frame/line spans
        const input =
          '<code class="language-tsx"><span class="frame">' +
          '<span class="line"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> {</span>' +
          '<span class="line">  <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>;</span>' +
          '<span class="line">};</span>' +
          '</span></code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // Type name linked
        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        // Property definition (id, not href, on different line than the type name)
        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });
    });

    describe('type keyword as pl-en', () => {
      it('links properties when "type" has pl-en class instead of pl-k', async () => {
        // Some highlighters emit "type" as pl-en instead of pl-k
        const input =
          '<code class="language-tsx"><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('links multiple properties when "type" has pl-en class', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">name</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:name" data-name="Item" data-prop="name" class="pl-v">name</span>',
        );
        expect(output).toContain(
          '<span id="item:count" data-name="Item" data-prop="count" class="pl-v">count</span>',
        );
      });
    });

    describe('property detection priority', () => {
      it('prefers highlighted span over plain text when both could match', async () => {
        // If a future starry-night version highlights object literal props as pl-v,
        // the span detection should take priority over text parsing
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">5</span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // type-annotation owner: should link via the span with href, preserving the class
        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label" class="pl-v">label</a>',
        );
      });
    });

    describe('union-in-object type definitions', () => {
      it('links properties in the first union branch', async () => {
        // type Details = ( | { reason: string } | { reason: number } ) & { cancel: () => void };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // All properties should be linked — no bare pl-v spans remaining
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">cancel</span>');
        expect(output).toContain('id="details:cancel"');
      });

      it('links duplicate property names in every union branch', async () => {
        // Two branches with the same property names
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-en">MouseEvent</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-en">Event</span>; }' +
          ');</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // No unlinked pl-v property spans should remain
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">event</span>');
      });

      it('links properties in both union branches', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-c1">Event</span>; }' +
          ');</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain('id="details:reason"');
        expect(output).toContain('id="details:event"');
      });

      it('links properties in intersection part after union', async () => {
        // type Details = ( | { a: string } ) & { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure union without intersection', async () => {
        // type Details = | { a: string } | { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> ' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).not.toContain('<span class="pl-v">a</span>');
        expect(output).not.toContain('<span class="pl-v">b</span>');
        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure intersection without union', async () => {
        // type Details = { a: string } & { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; } <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).not.toContain('<span class="pl-v">a</span>');
        expect(output).not.toContain('<span class="pl-v">b</span>');
        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties across line boundaries in multi-line union', async () => {
        const input =
          '<code class="language-tsx"><span class="frame">' +
          '<span class="line"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (</span>' +
          '<span class="line">  <span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }</span>' +
          '<span class="line">  <span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }</span>' +
          '<span class="line">) <span class="pl-k">&amp;</span> {</span>' +
          '<span class="line">  <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>;</span>' +
          '<span class="line">};</span>' +
          '</span></code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // No bare pl-v property spans should remain
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">cancel</span>');
        expect(output).toContain('id="details:cancel"');
      });

      it('does not leak typeDefPersist to unrelated code after type without semicolon', async () => {
        // type A = { x: string } then an unrelated object literal on a new statement
        // Without proper cleanup, the second { } would get linked as A's properties
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">A</span> <span class="pl-k">=</span> { <span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }\n' +
          '<span class="pl-k">type</span> <span class="pl-en">B</span> <span class="pl-k">=</span> { <span class="pl-v">y</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }</code>';
        const anchorMap = { A: '#a', B: '#b' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        // x should belong to A, y should belong to B
        expect(output).toContain('id="a:x"');
        expect(output).toContain('id="b:y"');
        // y should NOT be linked as A's property
        expect(output).not.toContain('id="a:y"');
      });

      it('does not leak typeDefPersist when type alias has no trailing semicolon', async () => {
        // type A = { x: string } (no semicolon) — B should not inherit A's context
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">A</span> <span class="pl-k">=</span> { <span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> { unrelated<span class="pl-k">:</span> <span class="pl-c1">true</span> }</code>';
        const anchorMap = { A: '#a' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow');

        expect(output).toContain('id="a:x"');
        // "unrelated" should NOT be linked as A's property
        expect(output).not.toContain('id="a:unrelated"');
      });

      it('uses typePropRefComponent for union properties', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: anchorMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain('<TypePropRef id="details:reason"');
        expect(output).toContain('<TypePropRef id="details:cancel"');
      });
    });
  });

  describe('language-aware feature gating', () => {
    async function process(
      input: string,
      anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeExportLinks, { anchorMap, linkProps: 'shallow' })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('type definition gating', () => {
      it('links type definition properties in language-typescript', async () => {
        const input =
          '<code class="language-typescript"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';

        const output = await process(input, { js: { Item: '#item' } });

        expect(output).toContain('id="item:label"');
      });

      it('does NOT link type definition properties in language-javascript', async () => {
        const input =
          '<code class="language-javascript"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';

        const output = await process(input, { js: { Item: '#item' } });

        expect(output).not.toContain('id="item:label"');
        expect(output).toContain('<span class="pl-v">label</span>');
      });

      it('does NOT link type definition properties in language-jsx', async () => {
        const input =
          '<code class="language-jsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';

        const output = await process(input, { js: { Item: '#item' } });

        expect(output).not.toContain('id="item:label"');
        expect(output).toContain('<span class="pl-v">label</span>');
      });
    });

    describe('type annotation gating (const name: Type = {})', () => {
      it('links annotated object properties in language-ts', async () => {
        const input =
          '<code class="language-ts"><span class="pl-k">const</span> <span class="pl-c1">cfg</span><span class="pl-k">:</span> <span class="pl-en">Options</span> <span class="pl-k">=</span> { timeout: <span class="pl-c1">1000</span> };</code>';

        const output = await process(input, { js: { Options: '#options' } });

        expect(output).toContain('href="#options:timeout"');
      });

      it('does NOT link annotated object properties in language-js', async () => {
        const input =
          '<code class="language-js"><span class="pl-k">const</span> <span class="pl-c1">cfg</span><span class="pl-k">:</span> <span class="pl-en">Options</span> <span class="pl-k">=</span> { timeout: <span class="pl-c1">1000</span> };</code>';

        const output = await process(input, { js: { Options: '#options' } });

        expect(output).not.toContain('href="#options:timeout"');
      });
    });

    describe('JSX gating', () => {
      it('links JSX component properties in language-jsx', async () => {
        const input =
          '<code class="language-jsx">&#x3C;<span class="pl-c1">Button</span> <span class="pl-e">onClick</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">handler</span><span class="pl-pse">}</span>></code>';

        const output = await process(input, { js: { Button: '#button' } });

        expect(output).toContain('href="#button::on-click"');
      });

      it('does NOT link JSX component properties in language-typescript', async () => {
        const input =
          '<code class="language-typescript">&#x3C;<span class="pl-c1">Button</span> <span class="pl-e">onClick</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">handler</span><span class="pl-pse">}</span>></code>';

        const output = await process(input, { js: { Button: '#button' } });

        expect(output).not.toContain('href="#button::on-click"');
      });

      it('does NOT link JSX component properties in language-js', async () => {
        const input =
          '<code class="language-js">&#x3C;<span class="pl-c1">Button</span> <span class="pl-e">onClick</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">handler</span><span class="pl-pse">}</span>></code>';

        const output = await process(input, { js: { Button: '#button' } });

        expect(output).not.toContain('href="#button::on-click"');
      });
    });

    describe('pl-en "type" keyword gating', () => {
      it('does NOT recognize "type" as pl-en in language-javascript', async () => {
        const input =
          '<code class="language-javascript"><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';

        const output = await process(input, { js: { Item: '#item' } });

        expect(output).not.toContain('id="item:label"');
      });
    });

    describe('function call gating (semantics: js)', () => {
      it('links function call properties in language-tsx', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';

        const output = await process(input, { js: { makeItem: '#make-item' } });

        expect(output).toContain('href="#make-item::label"');
      });

      it('does NOT link function call properties when no language class is present', async () => {
        const input =
          '<code><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';

        const output = await process(input, { js: { makeItem: '#make-item' } });

        expect(output).not.toContain('href="#make-item::label"');
      });

      it('does NOT link function call properties in unknown language', async () => {
        const input =
          '<code class="language-python"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';

        const output = await process(input, { js: { makeItem: '#make-item' } });

        expect(output).not.toContain('href="#make-item::label"');
      });
    });

    describe('platform-scoped anchor maps', () => {
      it('uses js anchor map for JS-family code blocks', async () => {
        const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';

        const output = await process(input, {
          js: { Trigger: '#trigger' },
          css: { Trigger: '#css-trigger' },
        });

        expect(output).toContain('href="#trigger"');
        expect(output).not.toContain('href="#css-trigger"');
      });

      it('uses css anchor map for CSS code blocks', async () => {
        const input = '<code class="language-css"><span class="pl-c1">color</span></code>';

        const output = await process(input, {
          js: { color: '#js-color' },
          css: { color: '#color' },
        });

        expect(output).toContain('href="#color"');
        expect(output).not.toContain('href="#js-color"');
      });

      it('uses css anchor map for SCSS code blocks', async () => {
        const input = '<code class="language-scss"><span class="pl-c1">color</span></code>';

        const output = await process(input, {
          css: { color: '#color' },
        });

        expect(output).toContain('href="#color"');
      });

      it('does NOT resolve any anchor map for unknown language', async () => {
        const input = '<code class="language-python"><span class="pl-c1">Trigger</span></code>';

        const output = await process(input, {
          js: { Trigger: '#trigger' },
          css: { Trigger: '#css-trigger' },
        });

        expect(output).not.toContain('href=');
      });

      it('does NOT resolve any anchor map when no language class is present', async () => {
        const input = '<code><span class="pl-c1">Trigger</span></code>';

        const output = await process(input, {
          js: { Trigger: '#trigger' },
        });

        expect(output).not.toContain('href=');
      });
    });

    describe('CSS code block linking', () => {
      it('links a pl-c1 property name span', async () => {
        const input = '<code class="language-css"><span class="pl-c1">color</span></code>';

        const output = await process(input, { css: { color: '#color' } });

        expect(output).toBe(
          '<code class="language-css"><a href="#color" class="pl-c1">color</a></code>',
        );
      });

      it('links a pl-c1 property name inside a line span', async () => {
        const input =
          '<code class="language-css"><span class="line" data-ln="38">  <span class="pl-c1">font-family</span>: <span class="pl-c1">var</span>(<span class="pl-v">--font-code</span>);</span></code>';

        const output = await process(input, {
          css: { 'font-family': '#font-family', '--font-code': '#font-code' },
        });

        expect(output).toContain('<a href="#font-family" class="pl-c1">font-family</a>');
        expect(output).toContain('<a href="#font-code" class="pl-v">--font-code</a>');
        expect(output).not.toContain('"#font-family:var"');
      });

      it('links a pl-v CSS variable span', async () => {
        const input =
          '<code class="language-css"><span class="line" data-ln="38">  <span class="pl-c1">font-family</span>: <span class="pl-c1">var</span>(<span class="pl-v">--font-code</span>);</span></code>';

        const output = await process(input, {
          css: { '--font-code': '#font-code' },
        });

        expect(output).toContain('<a href="#font-code" class="pl-v">--font-code</a>');
        expect(output).not.toContain('data-prop=');
      });

      it('links a pl-e class selector span', async () => {
        const input =
          '<code class="language-css"><span class="line" data-ln="34"><span class="pl-e">.name</span> <span class="pl-ent">span</span> {</span></code>';

        const output = await process(input, {
          css: { '.name': '#name' },
        });

        expect(output).toContain('<a href="#name" class="pl-e">.name</a>');
        expect(output).not.toContain('data-prop=');
      });

      it('links a pl-en span', async () => {
        const input = '<code class="language-css"><span class="pl-en">.my-class</span></code>';

        const output = await process(input, { css: { '.my-class': '#my-class' } });

        expect(output).toBe(
          '<code class="language-css"><a href="#my-class" class="pl-en">.my-class</a></code>',
        );
      });

      it('links a dotted chain in SCSS', async () => {
        const input =
          '<code class="language-scss"><span class="pl-en">color</span>.<span class="pl-en">primary</span></code>';

        const output = await process(input, { css: { 'color.primary': '#color-primary' } });

        expect(output).toBe(
          '<code class="language-scss"><a href="#color-primary"><span class="pl-en">color</span>.<span class="pl-en">primary</span></a></code>',
        );
      });

      it('works for LESS code blocks', async () => {
        const input = '<code class="language-less"><span class="pl-c1">color</span></code>';

        const output = await process(input, { css: { color: '#color' } });

        expect(output).toBe(
          '<code class="language-less"><a href="#color" class="pl-c1">color</a></code>',
        );
      });

      it('works for Sass code blocks', async () => {
        const input = '<code class="language-sass"><span class="pl-c1">color</span></code>';

        const output = await process(input, { css: { color: '#color' } });

        expect(output).toBe(
          '<code class="language-sass"><a href="#color" class="pl-c1">color</a></code>',
        );
      });

      it('does NOT link type definitions in CSS', async () => {
        const input =
          '<code class="language-css"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';

        const output = await process(input, { css: { Item: '#item' } });

        expect(output).not.toContain('id="item:label"');
      });

      it('does NOT link JSX properties in CSS', async () => {
        const input =
          '<code class="language-css">&#x3C;<span class="pl-c1">Button</span> <span class="pl-e">onClick</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">handler</span><span class="pl-pse">}</span>></code>';

        const output = await process(input, { css: { Button: '#button' } });

        expect(output).not.toContain('href="#button::on-click"');
      });

      it('does NOT link function call properties in CSS', async () => {
        const input =
          '<code class="language-css"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';

        const output = await process(input, { css: { makeItem: '#make-item' } });

        expect(output).not.toContain('href="#make-item::label"');
      });

      it('does NOT use the js anchor map for CSS code blocks', async () => {
        const input = '<code class="language-css"><span class="pl-c1">color</span></code>';

        const output = await process(input, { js: { color: '#js-color' } });

        expect(output).not.toContain('href=');
      });

      it('does NOT link pl-v spans in JS code blocks', async () => {
        const input = '<code class="language-tsx"><span class="pl-v">--font-code</span></code>';

        const output = await process(input, { js: { '--font-code': '#font-code' } });

        expect(output).not.toContain('href="#font-code"');
      });

      it('does NOT link pl-e spans in JS code blocks (without owner context)', async () => {
        const input = '<code class="language-tsx"><span class="pl-e">.name</span></code>';

        const output = await process(input, { js: { '.name': '#name' } });

        expect(output).not.toContain('href="#name"');
      });
    });

    describe('CSS property-value owner context', () => {
      it('links a CSS value as property of the CSS property name', async () => {
        // justify-content: space-between;
        const input =
          '<code class="language-css"><span class="pl-c1">justify-content</span>: <span class="pl-c1">space-between</span>;</code>';

        const output = await process(input, {
          css: { 'justify-content': '#justify-content' },
        });

        expect(output).toBe(
          '<code class="language-css"><a href="#justify-content" class="pl-c1">justify-content</a>: <a href="#justify-content:space-between" data-name="justify-content" data-prop="space-between" class="pl-c1">space-between</a>;</code>',
        );
      });

      it('links multiple CSS values within one declaration', async () => {
        // border: solid transparent;
        const input =
          '<code class="language-css"><span class="pl-c1">border</span>: <span class="pl-c1">solid</span> <span class="pl-c1">transparent</span>;</code>';

        const output = await process(input, {
          css: { border: '#border' },
        });

        expect(output).toBe(
          '<code class="language-css"><a href="#border" class="pl-c1">border</a>: <a href="#border:solid" data-name="border" data-prop="solid" class="pl-c1">solid</a> <a href="#border:transparent" data-name="border" data-prop="transparent" class="pl-c1">transparent</a>;</code>',
        );
      });

      it('does NOT link CSS function calls as values', async () => {
        // font-family: var(--font-code);
        const input =
          '<code class="language-css"><span class="pl-c1">font-family</span>: <span class="pl-c1">var</span>(<span class="pl-v">--font-code</span>);</code>';

        const output = await process(input, {
          css: { 'font-family': '#font-family' },
        });

        expect(output).toContain('<a href="#font-family" class="pl-c1">font-family</a>');
        expect(output).not.toContain('"#font-family:var"');
      });

      it('does NOT link numeric CSS values', async () => {
        // padding: 8;
        const input =
          '<code class="language-css"><span class="pl-c1">padding</span>: <span class="pl-c1">8</span>;</code>';

        const output = await process(input, {
          css: { padding: '#padding' },
        });

        expect(output).not.toContain('href="#padding:8"');
      });

      it('does NOT link decimal numeric CSS values', async () => {
        // line-height: 1.5;
        const input =
          '<code class="language-css"><span class="pl-c1">line-height</span>: <span class="pl-c1">1.5</span>;</code>';

        const output = await process(input, {
          css: { 'line-height': '#line-height' },
        });

        expect(output).not.toContain('href="#line-height:');
      });

      it('ends the CSS owner context at semicolon', async () => {
        // color: red; font-size: large;
        // "large" should NOT be linked as a value of "color"
        const input =
          '<code class="language-css"><span class="pl-c1">color</span>: <span class="pl-c1">red</span>; <span class="pl-c1">font-size</span>: <span class="pl-c1">large</span>;</code>';

        const output = await process(input, {
          css: { color: '#color', 'font-size': '#font-size' },
        });

        expect(output).toContain('href="#color:red"');
        expect(output).toContain('href="#font-size:large"');
        expect(output).not.toContain('href="#color:large"');
      });

      it('does NOT create owner context when property is not in anchor map', async () => {
        const input =
          '<code class="language-css"><span class="pl-c1">unknown-prop</span>: <span class="pl-c1">value</span>;</code>';

        const output = await process(input, { css: {} });

        expect(output).not.toContain('data-prop=');
      });

      it('standalone link takes priority over CSS value linking', async () => {
        // color: transparent; where "transparent" itself is in the anchor map
        const input =
          '<code class="language-css"><span class="pl-c1">color</span>: <span class="pl-c1">transparent</span>;</code>';

        const output = await process(input, {
          css: { color: '#color', transparent: '#transparent' },
        });

        // "transparent" linked as standalone, not as value of "color"
        expect(output).toContain('href="#transparent"');
        expect(output).not.toContain('data-name="color"');
      });

      it('does NOT create CSS owner context in JS code blocks', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-c1">color</span>: <span class="pl-c1">red</span>;</code>';

        const output = await process(input, {
          js: { color: '#color' },
        });

        expect(output).not.toContain('href="#color:red"');
      });

      it('works inside line spans', async () => {
        const input =
          '<code class="language-css"><span class="line" data-ln="5">  <span class="pl-c1">display</span>: <span class="pl-c1">flex</span>;</span></code>';

        const output = await process(input, {
          css: { display: '#display' },
        });

        expect(output).toContain(
          '<a href="#display" class="pl-c1">display</a>: <a href="#display:flex" data-name="display" data-prop="flex" class="pl-c1">flex</a>;',
        );
      });
    });
  });

  describe('linkParams option', () => {
    /**
     * Helper to process HTML with linkParams enabled.
     */
    async function processWithParams(
      input: string,
      anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
      opts?: {
        linkProps?: 'shallow' | 'deep';
        linkParams?: boolean;
        typePropRefComponent?: string;
        typeParamRefComponent?: string;
        typeRefComponent?: string;
      },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeExportLinks, {
          anchorMap,
          linkParams: opts?.linkParams ?? true,
          ...opts,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('type definition with arrow function params (definition site)', () => {
      it('links params in type Callback = (details: EventDetails) => void', async () => {
        // type Callback = (details: EventDetails) => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">EventDetails</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).not.toContain('<span class="pl-v">details</span>');
      });

      it('links multiple params with correct names', async () => {
        // type Callback = (one: A, two: B) => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">A</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">B</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('id="callback[1]"');
      });

      it('does not link params when type is not in anchorMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('<span class="pl-v">details</span>');
        expect(output).not.toContain('id=');
      });
    });

    describe('type annotation with arrow function (reference site)', () => {
      it('links params positionally via anchorMap[Owner[N]]', async () => {
        // const cb: Callback = (d) => {}
        // starry-night: const is pl-k, cb is pl-c1, : is pl-k, Callback is pl-en, = is pl-k, ( d ) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#callback:details"');
      });

      it('falls back to positional when named anchor is missing', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#callback[0]"');
      });

      it('links multiple params with correct indices', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">a</span>, <span class="pl-v">b</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:one',
          'Callback[1]': '#callback:two',
        };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#callback:one"');
        expect(output).toContain('href="#callback:two"');
      });
    });

    describe('callback property in type def (deep definition)', () => {
      it('links params of a callback property in a type definition', async () => {
        // type Opts = { callback: (details: X) => void }
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const anchorMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        // The callback property itself is linked as a definition
        expect(output).toContain('id="opts:callback"');
        // The param is linked with positional format (definition site)
        expect(output).toContain('id="opts:callback[0]"');
      });

      it('links multiple callback params with correct names (definition)', async () => {
        // type Opts = { callback: (one: A, two: B) => void }
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">A</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">B</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const anchorMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        expect(output).toContain('id="opts:callback[0]"');
        expect(output).toContain('id="opts:callback[1]"');
      });

      it('uses named param anchor for callback params when available', async () => {
        // type Opts = { callback: (details: X) => void }
        // with Opts:callback[0] → #opts:callback:details
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const anchorMap = {
          Opts: '#opts',
          'Opts:callback[0]': '#opts:callback:details',
        };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        expect(output).toContain('id="opts:callback:details"');
      });
    });

    describe('callback property in object literal (deep reference)', () => {
      it('links params with positional indices', async () => {
        // const opts: Type = { callback: (one, two) => {} }
        // In object literals, property name + colon are in one text node
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">opts</span><span class="pl-k">:</span> <span class="pl-en">Type</span> <span class="pl-k">=</span> { callback: (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {} }</code>';
        const anchorMap = { Type: '#type' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        // The callback property is linked as a reference
        expect(output).toContain('href="#type:callback"');
        // Params are reference site with positional
        expect(output).toContain('href="#type:callback[0]"');
        expect(output).toContain('href="#type:callback[1]"');
      });

      it('uses named param anchor for callback params when available', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">opts</span><span class="pl-k">:</span> <span class="pl-en">Type</span> <span class="pl-k">=</span> { callback: (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {} }</code>';
        const anchorMap = {
          Type: '#type',
          'Type:callback[0]': '#type:callback:first',
          'Type:callback[1]': '#type:callback:second',
        };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#type:callback:first"');
        expect(output).toContain('href="#type:callback:second"');
      });
    });

    describe('JSX callback prop', () => {
      it('links params of callback in JSX attribute value', async () => {
        // <Test func={(one, two) => {}} />
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Test</span> <span class="pl-e">func</span><span class="pl-k">=</span>{(<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}} /></code>';
        const anchorMap = {
          Test: '#test',
          'Test[0]': '#test:props',
          'Test:func[0]': '#test:props:func:first',
          'Test:func[1]': '#test:props:func:second',
        };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#test:props:func:first"');
        expect(output).toContain('href="#test:props:func:second"');
      });

      it('falls back to positional without named param anchors', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Test</span> <span class="pl-e">func</span><span class="pl-k">=</span>{(<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}} /></code>';
        const anchorMap = { Test: '#test', 'Test[0]': '#test:props' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#test:props:func[0]"');
        expect(output).toContain('href="#test:props:func[1]"');
      });
    });

    describe('standalone typed arrow function (reference site)', () => {
      it('links params via annotation type', async () => {
        // const func: Test = (one, two) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">func</span><span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = {
          Test: '#test',
          'Test[0]': '#test:first',
          'Test[1]': '#test:second',
        };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#test:first"');
        expect(output).toContain('href="#test:second"');
      });

      it('falls back to positional without named anchors', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">func</span><span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Test: '#test' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#test[0]"');
        expect(output).toContain('href="#test[1]"');
      });
    });

    describe('function declaration (reference site)', () => {
      it('links params of a function in the anchorMap', async () => {
        // function test(one: TypeA, two: TypeB) {}
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">test</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>) {}</code>';
        const anchorMap = {
          test: '#test',
          'test[0]': '#test:first',
          'test[1]': '#test:second',
        };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#test:first"');
        expect(output).toContain('href="#test:second"');
      });

      it('falls back to positional without named anchors', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">test</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>) {}</code>';
        const anchorMap = { test: '#test' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#test[0]"');
        expect(output).toContain('href="#test[1]"');
      });

      it('does not link params when function is not in anchorMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">unknown</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>) {}</code>';
        const anchorMap = { test: '#test' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('<span class="pl-v">one</span>');
        expect(output).not.toContain('href=');
      });
    });

    describe('feature gating', () => {
      it('does not link params when linkParams is not set', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeExportLinks, { anchorMap: { js: anchorMap } })
          .use(rehypeStringify)
          .process(input);

        const output = String(result);
        expect(output).toContain('<span class="pl-v">details</span>');
        expect(output).not.toContain('id="callback[0]"');
      });

      it('works independently of linkProps', async () => {
        // linkParams: true but no linkProps — should still link function params
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
      });
    });

    describe('edge cases', () => {
      it('handles empty parameter list', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> () <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        // No param-related id= or data-param= should appear
        expect(output).not.toContain('data-param=');
      });

      it('does not interfere with existing linkProps behavior', async () => {
        // type Item = { label: string }  — existing linkProps still works when linkParams is also on
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'shallow' });

        expect(output).toContain('id="item:label"');
      });

      it('uses typeParamRefComponent for param elements', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(
          input,
          { js: anchorMap },
          {
            typeParamRefComponent: 'TypeParamRef',
          },
        );

        expect(output).toContain('<TypeParamRef id="callback[0]"');
        expect(output).toContain(' name="Callback"');
        expect(output).toContain(' param="details"');
      });

      it('emits data-param instead of data-prop without custom component', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('data-param="details"');
        expect(output).not.toContain('data-prop="details"');
      });

      it('uses typeParamRefComponent at reference site', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(
          input,
          { js: anchorMap },
          {
            typeParamRefComponent: 'TypeParamRef',
          },
        );

        expect(output).toContain('<TypeParamRef href="#callback:details"');
        expect(output).toContain(' name="Callback"');
        expect(output).toContain(' param="details"');
      });

      it('does not link params in CSS code blocks', async () => {
        // CSS doesn't have function params in the same sense
        const input = '<code class="language-css">(<span class="pl-v">details</span>)</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { css: anchorMap });

        expect(output).toContain('<span class="pl-v">details</span>');
      });

      it('does not mis-count commas inside destructured parameters', async () => {
        // const cb: Callback = ({ a, b }, second) => {}
        // The destructured { a, b } is a single parameter [0], second is [1]
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> ({ <span class="pl-v">a</span>, <span class="pl-v">b</span> }, <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:opts',
          'Callback[1]': '#callback:second',
        };

        const output = await processWithParams(input, { js: anchorMap });

        // "second" should get index [1] → resolved to #callback:second
        expect(output).toContain('href="#callback:second"');
        // It must NOT use index [2] (which would happen if the comma inside {} was counted)
        expect(output).not.toContain('[2]');
      });

      it('does not mis-count commas inside array destructured parameters', async () => {
        // const cb: Callback = ([a, b], second) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> ([<span class="pl-v">a</span>, <span class="pl-v">b</span>], <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:items',
          'Callback[1]': '#callback:second',
        };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#callback:second"');
        expect(output).not.toContain('[2]');
      });

      it('does not trigger param linking on non-function parenthesized expressions (type annotation)', async () => {
        // const x: Callback = (value)  — grouped expression, NOT a function
        // Because there's no => after ), param linking should NOT activate
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">value</span>)</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        // Should NOT create any param ref (no data-param or href to callback param)
        expect(output).not.toContain('data-param=');
        expect(output).not.toContain('href="#callback[0]"');
        // The pl-v span should be unchanged
        expect(output).toContain('<span class="pl-v">value</span>');
      });

      it('does not trigger param linking on non-function parenthesized expressions (type def)', async () => {
        // type Callback = (SomeType)  — a parenthesized type, NOT a function signature
        // Because there's no => after ), param linking should NOT activate
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">value</span>)</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).not.toContain('data-param=');
        expect(output).not.toContain('id="callback:');
        expect(output).toContain('<span class="pl-v">value</span>');
      });

      it('does not leak sawFunctionKeyword after anonymous function expression', async () => {
        // function () {}  then  name(  — the name( should NOT be treated as a function declaration
        // This tests that sawFunctionKeyword is cleared by anonymous function's (
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> () {} <span class="pl-en">Callback</span>()</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        // Callback should NOT have param linking applied (sawFunctionKeyword should have been cleared)
        expect(output).not.toContain('data-param=');
      });

      it('does not trigger param linking on non-function parens in deep callback context', async () => {
        // type Opts = { callback: (value) }  — no => after ), so NOT a function
        // Param linking should not activate; property linking may still wrap spans.
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">value</span>) }</code>';
        const anchorMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: anchorMap }, { linkProps: 'deep' });

        // No param refs should be created
        expect(output).not.toContain('data-param=');
        // The span should NOT have param-style linking (no href to callback[0])
        expect(output).not.toContain('callback[0]');
        expect(output).not.toContain('callback:value');
      });

      it('does not link destructured binding identifiers as top-level params', async () => {
        // type Callback = ({ a, b }: Opts) => void
        // Only the outer destructured param should be linked (index 0), not inner bindings a and b
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> ({ <span class="pl-v">a</span>, <span class="pl-v">b</span> }<span class="pl-k">:</span> <span class="pl-en">Opts</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        // a and b are inside destructuring braces — they should NOT be linked as params
        expect(output).not.toContain('data-param="a"');
        expect(output).not.toContain('data-param="b"');
        // The pl-v spans inside destructuring should be preserved as-is
        expect(output).toContain('<span class="pl-v">a</span>');
        expect(output).toContain('<span class="pl-v">b</span>');
      });

      it('links params in arrow functions with return-type annotations', async () => {
        // type Callback = (details: X): Result => void
        // The `: Result` after `)` is a return-type annotation, not a blocker for arrow detection
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>)<span class="pl-k">:</span> <span class="pl-en">Result</span> <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="details"');
      });

      it('links params in annotation arrow functions with return-type annotations', async () => {
        // const cb: Callback = (d): Result => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>)<span class="pl-k">:</span> <span class="pl-en">Result</span> <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('href="#callback:details"');
        expect(output).toContain('data-param="d"');
      });

      it('links params with complex return-type annotations (union/generic)', async () => {
        // type Callback = (details: X): Promise<A | B> => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>)<span class="pl-k">:</span> <span class="pl-en">Promise</span>&lt;<span class="pl-en">A</span> <span class="pl-k">|</span> <span class="pl-en">B</span>&gt; <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="details"');
      });

      it('does not false-positive on ternary expressions after parens', async () => {
        // type Callback = (SomeType) ? A : B  — not an arrow function
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">value</span>) ? <span class="pl-en">A</span> : <span class="pl-en">B</span></code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).not.toContain('data-param=');
        expect(output).toContain('<span class="pl-v">value</span>');
      });

      it('does not link default value identifiers as params', async () => {
        // type Callback = (first = fallback) => {}
        // `fallback` is a default value, not a parameter — should NOT be linked
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">first</span> <span class="pl-k">=</span> <span class="pl-v">fallback</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="first"');
        expect(output).not.toContain('data-param="fallback"');
        expect(output).toContain('<span class="pl-v">fallback</span>');
      });

      it('resets default value tracking at commas between params', async () => {
        // type Callback = (first = fallback, second) => {}
        // `fallback` is default for first, `second` is an independent param at index 1
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">first</span> <span class="pl-k">=</span> <span class="pl-v">fallback</span>, <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="first"');
        expect(output).not.toContain('data-param="fallback"');
        expect(output).toContain('id="callback[1]"');
        expect(output).toContain('data-param="second"');
      });

      it('does not count commas inside generic type arguments as param separators', async () => {
        // type Fn = (first: Pair<A, B>, second: C) => void
        // The comma inside Pair<A, B> is inside angle brackets — not a param separator
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Fn</span> <span class="pl-k">=</span> (<span class="pl-v">first</span><span class="pl-k">:</span> <span class="pl-en">Pair</span>&lt;<span class="pl-en">A</span>, <span class="pl-en">B</span>&gt;, <span class="pl-v">second</span><span class="pl-k">:</span> <span class="pl-en">C</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="fn[0]"');
        expect(output).toContain('data-param="first"');
        expect(output).toContain('id="fn[1]"');
        expect(output).toContain('data-param="second"');
        // Must NOT produce index 2
        expect(output).not.toContain('fn[2]');
      });

      it('handles nested generics with multiple commas correctly', async () => {
        // type Fn = (first: Map<string, Array<A, B>>, second: C) => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Fn</span> <span class="pl-k">=</span> (<span class="pl-v">first</span><span class="pl-k">:</span> <span class="pl-en">Map</span>&lt;<span class="pl-c1">string</span>, <span class="pl-en">Array</span>&lt;<span class="pl-en">A</span>, <span class="pl-en">B</span>&gt;&gt;, <span class="pl-v">second</span><span class="pl-k">:</span> <span class="pl-en">C</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const anchorMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="fn[0]"');
        expect(output).toContain('data-param="first"');
        expect(output).toContain('id="fn[1]"');
        expect(output).toContain('data-param="second"');
        expect(output).not.toContain('fn[2]');
        expect(output).not.toContain('fn[3]');
      });

      it('does not treat comparison operators in defaults as generic brackets', async () => {
        // type Fn = (first = x < y, second) => {}
        // The `<` is a comparison operator, not a generic bracket — comma must still separate params
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Fn</span> <span class="pl-k">=</span> (<span class="pl-v">first</span> <span class="pl-k">=</span> <span class="pl-v">x</span> &lt; <span class="pl-v">y</span>, <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const anchorMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: anchorMap });

        expect(output).toContain('id="fn[0]"');
        expect(output).toContain('data-param="first"');
        expect(output).toContain('id="fn[1]"');
        expect(output).toContain('data-param="second"');
        expect(output).not.toContain('fn[2]');
      });
    });
  });

  describe('linkScope option', () => {
    /**
     * Helper to process HTML with linkScope enabled.
     */
    async function processWithScope(
      input: string,
      anchorMap: { js?: Record<string, string>; css?: Record<string, string> },
      opts?: {
        linkProps?: 'shallow' | 'deep';
        linkParams?: boolean;
        linkScope?: boolean;
        typeRefComponent?: string;
        typePropRefComponent?: string;
        typeParamRefComponent?: string;
      },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeExportLinks, {
          anchorMap,
          linkScope: opts?.linkScope ?? true,
          ...opts,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('function params with type annotations', () => {
      it('links a variable reference to the type its param was annotated with', async () => {
        // function test(one: TypeA) { console.log(one) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">one</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>one</a>');
        expect(output).not.toContain('<span class="pl-smi">one</span>');
      });

      it('links multiple params each to their own type', async () => {
        // function test(a: TypeA, b: TypeB) { use(a); use(b) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>, ' +
          '<span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>' +
          ') {' +
          '<span class="pl-smi">a</span>; <span class="pl-smi">b</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>a</a>');
        expect(output).toContain('<a href="#type-b"');
        expect(output).toContain('>b</a>');
      });
    });

    describe('const/let/var with type annotations', () => {
      it('links a const variable reference to its type annotation', async () => {
        // { const two: TypeB = ...; use(two) }
        const input =
          '<code class="language-tsx">{' +
          '<span class="pl-k">const</span> <span class="pl-c1">two</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span> <span class="pl-k">=</span> x; ' +
          '<span class="pl-smi">two</span>' +
          '}</code>';
        const anchorMap = { TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-b"');
        expect(output).toContain('>two</a>');
      });

      it('links a let variable reference to its type annotation', async () => {
        // { let x: TypeA; use(x) }
        const input =
          '<code class="language-tsx">{' +
          '<span class="pl-k">let</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>; ' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });

      it('links a var variable reference after declaration', async () => {
        // { var x: TypeA = ...; use(x) }
        const input =
          '<code class="language-tsx">{' +
          '<span class="pl-k">var</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> v; ' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('closures', () => {
      it('resolves outer param from inner function scope', async () => {
        // function outer(x: TypeA) { function inner() { use(x) } }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">outer</span>(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-k">function</span> <span class="pl-en">inner</span>() {' +
          '<span class="pl-smi">x</span>' +
          '}}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('shadowing', () => {
      it('inner const shadows outer param', async () => {
        // function outer(x: TypeA) { { const x: TypeB = ...; use(x) } }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">outer</span>(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {{' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span> <span class="pl-k">=</span> v; ' +
          '<span class="pl-smi">x</span>' +
          '}}</code>';
        const anchorMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        // Should link to TypeB (inner), not TypeA (outer)
        expect(output).toContain('<a href="#type-b"');
        expect(output).toContain('>x</a>');
        expect(output).not.toContain('<a href="#type-a">x</a>');
      });
    });

    describe('block scoping', () => {
      it('const does not leak out of block scope', async () => {
        // function test() { { const x: TypeB = ... } use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '{<span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span> <span class="pl-k">=</span> v;}' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        // x reference after block should NOT be linked (const is block-scoped)
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('var survives block scope (function-scoped)', async () => {
        // function test() { { var x: TypeA = ... } use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '{<span class="pl-k">var</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> v;}' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // var is function-scoped, so x should be linked after the block
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('destructured params', () => {
      it('links destructured param properties to the type', async () => {
        // function test({ a }: TypeA) { use(a) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>({' +
          '<span class="pl-v">a</span>' +
          '}<span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">a</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a:a"');
        expect(output).toContain('>a</a>');
      });
    });

    describe('arrow functions', () => {
      it('links variable reference in block arrow body', async () => {
        // const cb = (x: TypeA) => { use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">cb</span> <span class="pl-k">=</span> (' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') <span class="pl-k">=&gt;</span> {' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('return type annotations', () => {
      it('links param when function has return type annotation', async () => {
        // function test(x: TypeA): TypeB { use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ')<span class="pl-k">:</span> <span class="pl-en">TypeB</span> {' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        // x should still be linked despite the return type annotation between ) and {
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
      it('links param when return-type punctuation appears as plain text', async () => {
        // function test(x: TypeA): Promise<Result<T[]>> { use(x) }
        // — generic/array punctuation between ) and { is bare text, not spans
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          '): <span class="pl-en">Promise</span>&lt;<span class="pl-en">Result</span>&lt;T[]&gt;&gt; {' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
      it('links param when return type includes a pl-v type parameter', async () => {
        // (x: TypeA): Map<K, T> => { use(x) }
        // K and T tokenized as pl-v should not clear expectingFunctionBody
        const input =
          '<code class="language-tsx">(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ')<span class="pl-k">:</span> <span class="pl-en">Map</span>&lt;' +
          '<span class="pl-v">K</span>, <span class="pl-v">T</span>' +
          '&gt; <span class="pl-k">=&gt;</span> {' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // x should still resolve despite pl-v spans in the return type
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('negative tests (must stay unlinked)', () => {
      it('does not link use-before-declare', async () => {
        // function test() { use(x); const x: TypeA = ... }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-smi">x</span>;' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> v;' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // First x should NOT be linked (use-before-declare)
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('does not link untyped param', async () => {
        // function test(x) { use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">x</span>' +
          ') {' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // x has no type provenance -> should NOT be linked
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('does not link when linkScope is off', async () => {
        // function test(one: TypeA) { console.log(one) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">one</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap }, { linkScope: false });

        expect(output).toContain('<span class="pl-smi">one</span>');
      });

      it('does not link expression arrow body (no block)', async () => {
        // (x: TypeA) => x — no block body, so no scope is pushed
        const input =
          '<code class="language-tsx">(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') <span class="pl-k">=&gt;</span> <span class="pl-smi">x</span></code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // Without a block body, no function scope is created
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('does not link when variable has no scope match', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-smi">unknown</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<span class="pl-smi">unknown</span>');
      });

      it('does not link nested destructured params', async () => {
        // function test({ a: { b } }: TypeA) { use(b) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>({' +
          '<span class="pl-v">a</span><span class="pl-k">:</span> {' +
          '<span class="pl-v">b</span>' +
          '}}<span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">b</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // b is nested — uncertain provenance, stays unlinked
        expect(output).toContain('<span class="pl-smi">b</span>');
      });

      it('does not link destructured rename params', async () => {
        // function test({ a: renamed }: TypeA) { use(renamed) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>({' +
          '<span class="pl-v">a</span><span class="pl-k">:</span> ' +
          '<span class="pl-v">renamed</span>' +
          '}<span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">renamed</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // renamed is a destructured alias — uncertain provenance, stays unlinked
        expect(output).toContain('<span class="pl-smi">renamed</span>');
      });

      it('does not link variable via ternary colon', async () => {
        // function test() { const x = cond ? foo : Bar; use(x) }
        // The `:` is a ternary operator, not a type annotation. Even though
        // Bar is in the anchorMap, x must NOT get a type binding from it.
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> cond <span class="pl-k">?</span> foo <span class="pl-k">:</span> <span class="pl-en">Bar</span>;' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { Bar: '#bar' };

        const output = await processWithScope(input, { js: anchorMap });

        // x has no type annotation — ternary `:` must not bind it to Bar
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('does not create false function scope for if/while blocks', async () => {
        // function outer() { if (cond) { var x: TypeA = v; } use(x); }
        // var is function-scoped: x should be visible at outer scope, not trapped in a false
        // function scope created by `if (cond) { ... }`.
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">outer</span>() {' +
          '<span class="pl-k">if</span> (<span class="pl-smi">cond</span>) {' +
          '<span class="pl-k">var</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> v;' +
          '}' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // x declared with var inside `if` should be in outer function scope
        expect(output).toContain('>x</a>');
      });

      it('does not create false function scope for expression-bodied arrow returning object literal', async () => {
        // function outer(x: TypeA) { const fn = (y: TypeB) => ({ key: y }); use(x) }
        // The { in => ({ ... }) is an object literal, not a block body — it should NOT push
        // a function scope. Param y resolves inside the object, and x resolves outside it.
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">outer</span>(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-k">const</span> <span class="pl-c1">fn</span> <span class="pl-k">=</span> (' +
          '<span class="pl-v">y</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>' +
          ') <span class="pl-k">=&gt;</span> ({' +
          '<span class="pl-smi">y</span>' +
          '});' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        // y inside the object literal resolves to TypeB from the arrow param
        expect(output).toContain('<a href="#type-b"');
        expect(output).toContain('>y</a>');
        // x after the arrow resolves to TypeA from the outer function param
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('declaration order wins (last-write-wins)', () => {
      it('later declaration overwrites earlier binding in same scope', async () => {
        // function test() { const x: TypeA = a; const x: TypeB = b; use(x) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> a; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span> <span class="pl-k">=</span> b; ' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: anchorMap });

        // Last write wins — should link to TypeB
        expect(output).toContain('<a href="#type-b"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('feature interaction', () => {
      it('linkScope without linkParams — scope-derived vars link when type proven', async () => {
        // function test(one: TypeA) { use(one) }
        // With linkScope: true, linkParams: false — params not linked at definition site,
        // but scope-derived references still link at usage site
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">one</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap }, { linkParams: false });

        // Param at definition site should NOT be linked (linkParams: false)
        expect(output).toContain('<span class="pl-v">one</span>');
        // But the reference in the body SHOULD be linked via scope
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>one</a>');
      });

      it('linkScope with linkParams — both work together', async () => {
        // function test(one: TypeA) { use(one) }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>(' +
          '<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') {' +
          '<span class="pl-smi">one</span>' +
          '}</code>';
        const anchorMap = { TypeA: '#type-a', 'test[0]': '#test-one' };

        const output = await processWithScope(input, { js: anchorMap }, { linkParams: true });

        // Param at definition site should be linked (linkParams: true)
        expect(output).not.toContain('<span class="pl-v">one</span>');
        // The reference in the body should also be linked via scope
        expect(output).toContain('>one</a>');
      });

      it('links typed callback param inside function call via scope', async () => {
        // callFunction((one: TypeA) => { console.log(one) })
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-en">callFunction</span>((' +
          '<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') <span class="pl-k">=&gt;</span> {' +
          '<span class="pl-smi">one</span>' +
          '})</code>';
        const anchorMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: anchorMap });

        // `one` in the body should resolve to its type via scope
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>one</a>');
      });

      it('infers positional binding for unannotated callback param', async () => {
        // callFunction((one) => { console.log(one) })
        // one is callFunction[0][0] — the first param of the first callback arg
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-en">callFunction</span>((' +
          '<span class="pl-v">one</span>' +
          ') <span class="pl-k">=&gt;</span> {' +
          '<span class="pl-smi">one</span>' +
          '})</code>';
        const anchorMap = {
          callFunction: '#call-function',
          'callFunction[0][0]': '#call-function-0-0',
        };

        const output = await processWithScope(input, { js: anchorMap });

        // one should resolve to callFunction[0][0] via positional inference
        expect(output).toContain('<a href="#call-function-0-0"');
        expect(output).toContain('>one</a>');
      });

      it('infers positional binding for multiple unannotated callback params', async () => {
        // callFunction((a, b) => { use(a); use(b); })
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-en">callFunction</span>((' +
          '<span class="pl-v">a</span>, ' +
          '<span class="pl-v">b</span>' +
          ') <span class="pl-k">=&gt;</span> {' +
          '<span class="pl-smi">a</span>;' +
          '<span class="pl-smi">b</span>' +
          '})</code>';
        const anchorMap = {
          callFunction: '#call-function',
          'callFunction[0][0]': '#cf-a',
          'callFunction[0][1]': '#cf-b',
        };

        const output = await processWithScope(input, { js: anchorMap });

        expect(output).toContain('<a href="#cf-a"');
        expect(output).toContain('>a</a>');
        expect(output).toContain('<a href="#cf-b"');
        expect(output).toContain('>b</a>');
      });
    });
  });
});

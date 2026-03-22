import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import enhanceCodeTypes from './enhanceCodeTypes';
import type { ModuleLinkMapEntry } from './scanState';

describe('enhanceCodeTypes', () => {
  /**
   * Helper function to process HTML string through the plugin.
   * Parses HTML → applies enhancement → serializes back to HTML.
   */
  async function processHtml(
    input: string,
    linkMap: { js?: Record<string, string>; css?: Record<string, string> },
  ): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(enhanceCodeTypes, { linkMap })
      .use(rehypeStringify)
      .process(input);

    return String(result);
  }

  describe('single pl-c1 span linking', () => {
    it('converts a single matching pl-c1 span to an anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('does not modify a non-matching pl-c1 span', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Unknown</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Unknown</span></code>');
    });

    it('is case-sensitive when matching', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">trigger</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      // Should not match - case differs
      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">trigger</span></code>');
    });

    it('handles flat name that maps to dotted anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">AccordionTrigger</span></code>';
      const linkMap = { AccordionTrigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">AccordionTrigger</a></code>',
      );
    });

    it('preserves other content around the linked span', async () => {
      const input =
        '<code class="language-tsx">The <span class="pl-c1">Trigger</span> component</code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx">The <a href="#trigger" class="pl-c1">Trigger</a> component</code>',
      );
    });
  });

  describe('dotted chain linking', () => {
    it('wraps a two-part dotted chain in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a></code>',
      );
    });

    it('wraps a three-part dotted chain in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const linkMap = { 'Accordion.Trigger.State': '#trigger.state' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger.state"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></a></code>',
      );
    });

    it('does not link a chain that does not match', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Unknown</span></code>',
      );
    });

    it('only matches exact chains, not partial', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span>.<span class="pl-c1">State</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: linkMap });

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
      const linkMap = { Trigger: '#trigger', Root: '#root' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a> and <a href="#root" class="pl-c1">Root</a></code>',
      );
    });

    it('links a chain and a single span in the same code element', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span> or <span class="pl-c1">Root</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger', Root: '#root' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-c1">Trigger</span></a> or <a href="#root" class="pl-c1">Root</a></code>',
      );
    });
  });

  describe('edge cases', () => {
    it('processes code inside pre elements (block code)', async () => {
      const input =
        '<pre><code class="language-tsx"><span class="pl-c1">Trigger</span></code></pre>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      // Should link the span
      expect(output).toBe(
        '<pre><code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code></pre>',
      );
    });

    it('ignores spans without pl-c1 class', async () => {
      const input = '<code class="language-tsx"><span class="pl-ent">div</span></code>';
      const linkMap = { div: '#div' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-ent">div</span></code>');
    });

    it('handles empty linkMap gracefully', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const linkMap = {};

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Trigger</span></code>');
    });

    it('handles code element with no children', async () => {
      const input = '<code class="language-tsx"></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe('<code class="language-tsx"></code>');
    });

    it('handles non-consecutive pl-c1 spans as separate matches', async () => {
      // There's text between the spans, not just a dot
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span> <span class="pl-c1">Trigger</span></code>';
      const linkMap = { Accordion: '#accordion', Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#accordion" class="pl-c1">Accordion</a> <a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('does not form chain when text between spans is not just a dot', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>: <span class="pl-c1">Trigger</span></code>';
      const linkMap = {
        'Accordion.Trigger': '#trigger',
        Accordion: '#accordion',
        Trigger: '#trigger-standalone',
      };

      const output = await processHtml(input, { js: linkMap });

      // Should match as separate spans, not a chain
      expect(output).toBe(
        '<code class="language-tsx"><a href="#accordion" class="pl-c1">Accordion</a>: <a href="#trigger-standalone" class="pl-c1">Trigger</a></code>',
      );
    });
  });

  describe('pl-en class support (type names)', () => {
    it('converts a single matching pl-en span to an anchor', async () => {
      const input = '<code class="language-tsx"><span class="pl-en">InputType</span></code>';
      const linkMap = { InputType: '#inputtype' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#inputtype" class="pl-en">InputType</a></code>',
      );
    });

    it('wraps a dotted chain of pl-en spans in an anchor', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></code>';
      const linkMap = { 'Accordion.Root': '#root' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#root"><span class="pl-en">Accordion</span>.<span class="pl-en">Root</span></a></code>',
      );
    });

    it('handles mixed pl-c1 and pl-en spans in a chain', async () => {
      // In practice this is unlikely, but should work
      const input =
        '<code class="language-tsx"><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger"><span class="pl-c1">Accordion</span>.<span class="pl-en">Trigger</span></a></code>',
      );
    });

    it('links multiple pl-en spans separately', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">InputType</span> and <span class="pl-en">OutputType</span></code>';
      const linkMap = { InputType: '#inputtype', OutputType: '#outputtype' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#inputtype" class="pl-en">InputType</a> and <a href="#outputtype" class="pl-en">OutputType</a></code>',
      );
    });
  });

  describe('nested structure support (frame/line spans)', () => {
    it('links spans inside nested line elements', async () => {
      const input =
        '<code class="language-ts"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const linkMap = { 'Component.Root': '#root' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-ts"><span class="frame"><span class="line"><a href="#root"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></a></span></span></code>',
      );
    });

    it('links a three-part chain inside nested elements', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></span></span></code>';
      const linkMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="frame"><span class="line"><a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a></span></span></code>',
      );
    });

    it('handles complex nested structure with other content', async () => {
      // Mimics real output: | ((details: Component.Root.ChangeEventDetails) => void)
      const input =
        '<code class="language-ts"><span class="frame"><span class="line" data-ln="1"><span class="pl-k">|</span> ((<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span>)</span></span></code>';
      const linkMap = { 'Component.Root.ChangeEventDetails': '#changeeventdetails' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toContain(
        '<a href="#changeeventdetails"><span class="pl-en">Component</span>.<span class="pl-en">Root</span>.<span class="pl-en">ChangeEventDetails</span></a>',
      );
    });

    it('links multiple separate matches in deeply nested structure', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">TypeA</span> and <span class="pl-en">TypeB</span></span></span></code>';
      const linkMap = { TypeA: '#typea', TypeB: '#typeb' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><span class="frame"><span class="line"><a href="#typea" class="pl-en">TypeA</a> and <a href="#typeb" class="pl-en">TypeB</a></span></span></code>',
      );
    });

    it('does not create nested anchors when processing already-linked content', async () => {
      // If an anchor already exists with a linkable class, it should NOT be wrapped again
      const input =
        '<code class="language-tsx"><a href="#trigger" class="pl-en">Trigger</a></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      // Should remain unchanged - no nested anchors
      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-en">Trigger</a></code>',
      );
    });
  });

  describe('typeRefComponent option', () => {
    async function processHtmlWithTypeRef(
      input: string,
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
      typeRefComponent: string,
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, { linkMap, typeRefComponent })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    it('emits a custom component element instead of an anchor for a single span', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: linkMap }, 'TypeRef');

      expect(output).toBe(
        '<code class="language-tsx"><TypeRef href="#trigger" name="Trigger" class="pl-c1">Trigger</TypeRef></code>',
      );
    });

    it('emits a custom component element for a dotted chain', async () => {
      const input =
        '<code class="language-tsx"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const linkMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: linkMap }, 'TypeRef');

      expect(output).toBe(
        '<code class="language-tsx"><TypeRef href="#trigger" name="Accordion.Trigger"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></TypeRef></code>',
      );
    });

    it('still falls back to no linking when identifier is not in linkMap', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Unknown</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, { js: linkMap }, 'TypeRef');

      expect(output).toBe('<code class="language-tsx"><span class="pl-c1">Unknown</span></code>');
    });

    it('uses standard anchor when typeRefComponent is not set', async () => {
      const input = '<code class="language-tsx"><span class="pl-c1">Trigger</span></code>';
      const linkMap = { Trigger: '#trigger' };

      const output = await processHtml(input, { js: linkMap });

      expect(output).toBe(
        '<code class="language-tsx"><a href="#trigger" class="pl-c1">Trigger</a></code>',
      );
    });

    it('emits custom elements in nested structures', async () => {
      const input =
        '<code class="language-tsx"><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const linkMap = { 'Component.Root': '#root' };

      const output = await processHtmlWithTypeRef(input, { js: linkMap }, 'TypeRef');

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
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
      linkProps: 'shallow' | 'deep',
      opts?: { typePropRefComponent?: string; typeRefComponent?: string },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, { linkMap, linkProps, ...opts })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('type definition properties (pl-v spans)', () => {
      it('wraps pl-v property names with id spans (definitions)', async () => {
        // Matches starry-night output for: type Item = { label: string; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('wraps multiple pl-v properties', async () => {
        // type Item = { label: string; count: number; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('does not wrap properties when owner is not in linkMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
      });

      it('wraps multiple plain text properties', async () => {
        // const item: Item = { label: "hello", count: 5 };
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span>, count: <span class="pl-c1">5</span> };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
        expect(output).toContain(
          '<a href="#item:count" data-name="Item" data-prop="count">count</a>',
        );
      });

      it('does not wrap property when type annotation is not in linkMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).not.toContain('<a href=');
      });

      it('links properties when type annotation is a dotted chain', async () => {
        // const props: Accordion.Root.Props = { label: 'test' };
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">props</span><span class="pl-k">:</span> <span class="pl-en">Accordion</span>.<span class="pl-en">Root</span>.<span class="pl-en">Props</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>test<span class="pl-pds">"</span></span> };</code>';
        const linkMap = { 'Accordion.Root.Props': '#root.props' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('also links the function name as a type ref', async () => {
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:1:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('links properties of multiple object parameters with correct indices', async () => {
        // makeItem({ name: "a" }, { label: "b" })
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ name: <span class="pl-s"><span class="pl-pds">"</span>a<span class="pl-pds">"</span></span> }, { label: <span class="pl-s"><span class="pl-pds">"</span>b<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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

    describe('function call — not in linkMap', () => {
      it('does not wrap properties when function is not in linkMap', async () => {
        const input =
          '<code class="language-js"><span class="pl-en">unknownFn</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).not.toContain('<a href=');
        expect(output).not.toContain('<span id=');
        expect(output).toContain('label');
      });
    });

    describe('named parameter anchors (linkMap[name[N]])', () => {
      it('uses named param anchor as base href when available', async () => {
        // makeItem({ label: "hello" }) with makeItem[0] providing a named base
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:props:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('falls back to index-based href when named param anchor is missing', async () => {
        // makeItem({ label: "hello" }) without makeItem[0] in linkMap
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for non-zero parameter indices', async () => {
        // makeItem(someArg, { label: "hello" }) with makeItem[1] providing a named base
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>(<span class="pl-c1">someArg</span>, { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const linkMap = { makeItem: '#make-item', 'makeItem[1]': '#make-item:options' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:options:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for JSX component props', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const linkMap = { Card: '#card', 'Card[0]': '#card:props' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card:props:label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('falls back to index-based href for JSX when named anchor is missing', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const linkMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('uses named param anchor with deep nested property paths', async () => {
        // type equivalent with function call: makeItem({ details: { label: "hello" } })
        const input =
          '<code class="language-js"><span class="pl-en">makeItem</span>({ details: { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> } });</code>';
        const linkMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'deep');

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
        const linkMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('wraps multiple JSX attributes', async () => {
        // <Card label="hello" count={5} />
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> <span class="pl-e">count</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-c1">5</span><span class="pl-pse">}</span> /></code>';
        const linkMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
        expect(output).toContain(
          '<a href="#card::count" data-name="Card" data-prop="count" class="pl-e">count</a>',
        );
      });

      it('does not wrap attributes when component is not in linkMap', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Unknown</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const linkMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain('<span class="pl-e">label</span>');
      });
    });

    describe('nested objects (linkProps: deep)', () => {
      it('links nested property with dotted path', async () => {
        // type Item = { details: { label: string; }; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'deep');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'deep');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'deep');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain(
          '<span id="item:first-name" data-name="Item" data-prop="first-name" class="pl-v">firstName</span>',
        );
      });

      it('converts each segment of nested path independently', async () => {
        // type Item = { homeAddress: { streetName: string; }; };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">homeAddress</span><span class="pl-k">:</span> { <span class="pl-v">streetName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'deep');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef id="item:label" name="Item" prop="label" class="pl-v">label</TypePropRef>',
        );
      });

      it('emits custom element for plain text props', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#item:label" name="Item" prop="label">label</TypePropRef>',
        );
      });

      it('emits custom element for JSX pl-e props', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const linkMap = { Card: '#card' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#card::label" name="Card" prop="label" class="pl-e">label</TypePropRef>',
        );
      });

      it('applies kebab-case to prop attribute', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">firstName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
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
        const linkMap = { Item: '#item' };

        const output = await processHtml(input, { js: linkMap });

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('links multiple properties when "type" has pl-en class', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">name</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Item: '#item' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain('id="details:reason"');
        expect(output).toContain('id="details:event"');
      });

      it('links properties in intersection part after union', async () => {
        // type Details = ( | { a: string } ) & { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure union without intersection', async () => {
        // type Details = | { a: string } | { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> ' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).not.toContain('<span class="pl-v">a</span>');
        expect(output).not.toContain('<span class="pl-v">b</span>');
        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure intersection without union', async () => {
        // type Details = { a: string } & { b: number };
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; } <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { A: '#a', B: '#b' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

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
        const linkMap = { A: '#a' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow');

        expect(output).toContain('id="a:x"');
        // "unrelated" should NOT be linked as A's property
        expect(output).not.toContain('id="a:unrelated"');
      });

      it('uses typePropRefComponent for union properties', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>; };</code>';
        const linkMap = { Details: '#details' };

        const output = await processWithLinkProps(input, { js: linkMap }, 'shallow', {
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
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, { linkMap, linkProps: 'shallow' })
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
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
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
        .use(enhanceCodeTypes, {
          linkMap,
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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).not.toContain('<span class="pl-v">details</span>');
      });

      it('links multiple params with correct names', async () => {
        // type Callback = (one: A, two: B) => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">A</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">B</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('id="callback[1]"');
      });

      it('does not link params when type is not in linkMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('<span class="pl-v">details</span>');
        expect(output).not.toContain('id=');
      });
    });

    describe('type annotation with arrow function (reference site)', () => {
      it('links params positionally via linkMap[Owner[N]]', async () => {
        // const cb: Callback = (d) => {}
        // starry-night: const is pl-k, cb is pl-c1, : is pl-k, Callback is pl-en, = is pl-k, ( d ) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#callback:details"');
      });

      it('falls back to positional when named anchor is missing', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#callback[0]"');
      });

      it('links multiple params with correct indices', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">a</span>, <span class="pl-v">b</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:one',
          'Callback[1]': '#callback:two',
        };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#callback:one"');
        expect(output).toContain('href="#callback:two"');
      });
    });

    describe('callback property in type def (deep definition)', () => {
      it('links params of a callback property in a type definition', async () => {
        // type Opts = { callback: (details: X) => void }
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const linkMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        // The callback property itself is linked as a definition
        expect(output).toContain('id="opts:callback"');
        // The param is linked with positional format (definition site)
        expect(output).toContain('id="opts:callback[0]"');
      });

      it('links multiple callback params with correct names (definition)', async () => {
        // type Opts = { callback: (one: A, two: B) => void }
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">A</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">B</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const linkMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        expect(output).toContain('id="opts:callback[0]"');
        expect(output).toContain('id="opts:callback[1]"');
      });

      it('uses named param anchor for callback params when available', async () => {
        // type Opts = { callback: (details: X) => void }
        // with Opts:callback[0] → #opts:callback:details
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span> }</code>';
        const linkMap = {
          Opts: '#opts',
          'Opts:callback[0]': '#opts:callback:details',
        };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        expect(output).toContain('id="opts:callback:details"');
      });
    });

    describe('callback property in object literal (deep reference)', () => {
      it('links params with positional indices', async () => {
        // const opts: Type = { callback: (one, two) => {} }
        // In object literals, property name + colon are in one text node
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">opts</span><span class="pl-k">:</span> <span class="pl-en">Type</span> <span class="pl-k">=</span> { callback: (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {} }</code>';
        const linkMap = { Type: '#type' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        // The callback property is linked as a reference
        expect(output).toContain('href="#type:callback"');
        // Params are reference site with positional
        expect(output).toContain('href="#type:callback[0]"');
        expect(output).toContain('href="#type:callback[1]"');
      });

      it('uses named param anchor for callback params when available', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">opts</span><span class="pl-k">:</span> <span class="pl-en">Type</span> <span class="pl-k">=</span> { callback: (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {} }</code>';
        const linkMap = {
          Type: '#type',
          'Type:callback[0]': '#type:callback:first',
          'Type:callback[1]': '#type:callback:second',
        };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#type:callback:first"');
        expect(output).toContain('href="#type:callback:second"');
      });
    });

    describe('JSX callback prop', () => {
      it('links params of callback in JSX attribute value', async () => {
        // <Test func={(one, two) => {}} />
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Test</span> <span class="pl-e">func</span><span class="pl-k">=</span>{(<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}} /></code>';
        const linkMap = {
          Test: '#test',
          'Test[0]': '#test:props',
          'Test:func[0]': '#test:props:func:first',
          'Test:func[1]': '#test:props:func:second',
        };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#test:props:func:first"');
        expect(output).toContain('href="#test:props:func:second"');
      });

      it('falls back to positional without named param anchors', async () => {
        const input =
          '<code class="language-tsx">&#x3C;<span class="pl-c1">Test</span> <span class="pl-e">func</span><span class="pl-k">=</span>{(<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}} /></code>';
        const linkMap = { Test: '#test', 'Test[0]': '#test:props' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

        expect(output).toContain('href="#test:props:func[0]"');
        expect(output).toContain('href="#test:props:func[1]"');
      });
    });

    describe('standalone typed arrow function (reference site)', () => {
      it('links params via annotation type', async () => {
        // const func: Test = (one, two) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">func</span><span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = {
          Test: '#test',
          'Test[0]': '#test:first',
          'Test[1]': '#test:second',
        };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#test:first"');
        expect(output).toContain('href="#test:second"');
      });

      it('falls back to positional without named anchors', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">func</span><span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> (<span class="pl-v">one</span>, <span class="pl-v">two</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Test: '#test' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#test[0]"');
        expect(output).toContain('href="#test[1]"');
      });
    });

    describe('function declaration (reference site)', () => {
      it('links params of a function in the linkMap', async () => {
        // function test(one: TypeA, two: TypeB) {}
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">test</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>) {}</code>';
        const linkMap = {
          test: '#test',
          'test[0]': '#test:first',
          'test[1]': '#test:second',
        };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#test:first"');
        expect(output).toContain('href="#test:second"');
      });

      it('falls back to positional without named anchors', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">test</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>, <span class="pl-v">two</span><span class="pl-k">:</span> <span class="pl-en">TypeB</span>) {}</code>';
        const linkMap = { test: '#test' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#test[0]"');
        expect(output).toContain('href="#test[1]"');
      });

      it('does not link params when function is not in linkMap', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> <span class="pl-en">unknown</span>(<span class="pl-v">one</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>) {}</code>';
        const linkMap = { test: '#test' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('<span class="pl-v">one</span>');
        expect(output).not.toContain('href=');
      });
    });

    describe('feature gating', () => {
      it('does not link params when linkParams is not set', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, { linkMap: { js: linkMap } })
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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('id="callback[0]"');
      });
    });

    describe('edge cases', () => {
      it('handles empty parameter list', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> () <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        // No param-related id= or data-param= should appear
        expect(output).not.toContain('data-param=');
      });

      it('does not interfere with existing linkProps behavior', async () => {
        // type Item = { label: string }  — existing linkProps still works when linkParams is also on
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }</code>';
        const linkMap = { Item: '#item' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'shallow' });

        expect(output).toContain('id="item:label"');
      });

      it('uses typeParamRefComponent for param elements', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>) <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(
          input,
          { js: linkMap },
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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('data-param="details"');
        expect(output).not.toContain('data-prop="details"');
      });

      it('uses typeParamRefComponent at reference site', async () => {
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(
          input,
          { js: linkMap },
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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { css: linkMap });

        expect(output).toContain('<span class="pl-v">details</span>');
      });

      it('does not mis-count commas inside destructured parameters', async () => {
        // const cb: Callback = ({ a, b }, second) => {}
        // The destructured { a, b } is a single parameter [0], second is [1]
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> ({ <span class="pl-v">a</span>, <span class="pl-v">b</span> }, <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:opts',
          'Callback[1]': '#callback:second',
        };

        const output = await processWithParams(input, { js: linkMap });

        // "second" should get index [1] → resolved to #callback:second
        expect(output).toContain('href="#callback:second"');
        // It must NOT use index [2] (which would happen if the comma inside {} was counted)
        expect(output).not.toContain('[2]');
      });

      it('does not mis-count commas inside array destructured parameters', async () => {
        // const cb: Callback = ([a, b], second) => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> ([<span class="pl-v">a</span>, <span class="pl-v">b</span>], <span class="pl-v">second</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = {
          Callback: '#callback',
          'Callback[0]': '#callback:items',
          'Callback[1]': '#callback:second',
        };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#callback:second"');
        expect(output).not.toContain('[2]');
      });

      it('does not trigger param linking on non-function parenthesized expressions (type annotation)', async () => {
        // const x: Callback = (value)  — grouped expression, NOT a function
        // Because there's no => after ), param linking should NOT activate
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">x</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">value</span>)</code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).not.toContain('data-param=');
        expect(output).not.toContain('id="callback:');
        expect(output).toContain('<span class="pl-v">value</span>');
      });

      it('does not leak sawFunctionKeyword after anonymous function expression', async () => {
        // function () {}  then  name(  — the name( should NOT be treated as a function declaration
        // This tests that sawFunctionKeyword is cleared by anonymous function's (
        const input =
          '<code class="language-tsx"><span class="pl-k">function</span> () {} <span class="pl-en">Callback</span>()</code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        // Callback should NOT have param linking applied (sawFunctionKeyword should have been cleared)
        expect(output).not.toContain('data-param=');
      });

      it('does not trigger param linking on non-function parens in deep callback context', async () => {
        // type Opts = { callback: (value) }  — no => after ), so NOT a function
        // Param linking should not activate; property linking may still wrap spans.
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Opts</span> <span class="pl-k">=</span> { <span class="pl-v">callback</span><span class="pl-k">:</span> (<span class="pl-v">value</span>) }</code>';
        const linkMap = { Opts: '#opts' };

        const output = await processWithParams(input, { js: linkMap }, { linkProps: 'deep' });

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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="details"');
      });

      it('links params in annotation arrow functions with return-type annotations', async () => {
        // const cb: Callback = (d): Result => {}
        const input =
          '<code class="language-tsx"><span class="pl-k">const</span> <span class="pl-c1">cb</span><span class="pl-k">:</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">d</span>)<span class="pl-k">:</span> <span class="pl-en">Result</span> <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Callback: '#callback', 'Callback[0]': '#callback:details' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('href="#callback:details"');
        expect(output).toContain('data-param="d"');
      });

      it('links params with complex return-type annotations (union/generic)', async () => {
        // type Callback = (details: X): Promise<A | B> => void
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">details</span><span class="pl-k">:</span> <span class="pl-en">X</span>)<span class="pl-k">:</span> <span class="pl-en">Promise</span>&lt;<span class="pl-en">A</span> <span class="pl-k">|</span> <span class="pl-en">B</span>&gt; <span class="pl-k">=&gt;</span> <span class="pl-c1">void</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).toContain('id="callback[0]"');
        expect(output).toContain('data-param="details"');
      });

      it('does not false-positive on ternary expressions after parens', async () => {
        // type Callback = (SomeType) ? A : B  — not an arrow function
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">value</span>) ? <span class="pl-en">A</span> : <span class="pl-en">B</span></code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

        expect(output).not.toContain('data-param=');
        expect(output).toContain('<span class="pl-v">value</span>');
      });

      it('does not link default value identifiers as params', async () => {
        // type Callback = (first = fallback) => {}
        // `fallback` is a default value, not a parameter — should NOT be linked
        const input =
          '<code class="language-tsx"><span class="pl-k">type</span> <span class="pl-en">Callback</span> <span class="pl-k">=</span> (<span class="pl-v">first</span> <span class="pl-k">=</span> <span class="pl-v">fallback</span>) <span class="pl-k">=&gt;</span> {}</code>';
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Callback: '#callback' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: linkMap });

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
        const linkMap = { Fn: '#fn' };

        const output = await processWithParams(input, { js: linkMap });

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
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
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
        .use(enhanceCodeTypes, {
          linkMap,
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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap }, { linkScope: false });

        expect(output).toContain('<span class="pl-smi">one</span>');
      });

      it('does not link expression arrow body (no block)', async () => {
        // (x: TypeA) => x — no block body, so no scope is pushed
        const input =
          '<code class="language-tsx">(' +
          '<span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-en">TypeA</span>' +
          ') <span class="pl-k">=&gt;</span> <span class="pl-smi">x</span></code>';
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

        // Without a block body, no function scope is created
        expect(output).toContain('<span class="pl-smi">x</span>');
      });

      it('does not link when variable has no scope match', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-smi">unknown</span>' +
          '}</code>';
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

        // renamed is a destructured alias — uncertain provenance, stays unlinked
        expect(output).toContain('<span class="pl-smi">renamed</span>');
      });

      it('does not link variable via ternary colon', async () => {
        // function test() { const x = cond ? foo : Bar; use(x) }
        // The `:` is a ternary operator, not a type annotation. Even though
        // Bar is in the linkMap, x must NOT get a type binding from it.
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">function</span> <span class="pl-en">test</span>() {' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> cond <span class="pl-k">?</span> foo <span class="pl-k">:</span> <span class="pl-en">Bar</span>;' +
          '<span class="pl-smi">x</span>' +
          '}</code>';
        const linkMap = { Bar: '#bar' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a', TypeB: '#type-b' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap }, { linkParams: false });

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
        const linkMap = { TypeA: '#type-a', 'test[0]': '#test-one' };

        const output = await processWithScope(input, { js: linkMap }, { linkParams: true });

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
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = {
          callFunction: '#call-function',
          'callFunction[0][0]': '#call-function-0-0',
        };

        const output = await processWithScope(input, { js: linkMap });

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
        const linkMap = {
          callFunction: '#call-function',
          'callFunction[0][0]': '#cf-a',
          'callFunction[0][1]': '#cf-b',
        };

        const output = await processWithScope(input, { js: linkMap });

        expect(output).toContain('<a href="#cf-a"');
        expect(output).toContain('>a</a>');
        expect(output).toContain('<a href="#cf-b"');
        expect(output).toContain('>b</a>');
      });
    });
  });

  describe('linkValues option', () => {
    async function processWithValues(
      input: string,
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
      opts?: {
        linkProps?: 'shallow' | 'deep';
        linkParams?: boolean;
        linkScope?: boolean;
        linkValues?: boolean;
        linkArrays?: boolean;
        typeValueRefComponent?: string;
        typeRefComponent?: string;
      },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, {
          linkMap,
          linkScope: opts?.linkScope ?? true,
          linkValues: opts?.linkValues ?? true,
          linkArrays: opts?.linkArrays,
          ...opts,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('simple string const', () => {
      it('annotates a variable reference with its string literal value', async () => {
        // const x = 'hello'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello&#x27;"');
        expect(output).toContain('>x</span>');
        expect(output).not.toContain('<span class="pl-smi">x</span>');
      });

      it('annotates with double-quoted strings normalised to single quotes', async () => {
        // const x = "world"; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">"</span>world<span class="pl-pds">"</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;world&#x27;"');
        expect(output).toContain('>x</span>');
      });

      it('escapes embedded single quotes in double-quoted strings', async () => {
        // const x = "can't"; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">"</span>can\'t<span class="pl-pds">"</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;can\\&#x27;t&#x27;"');
      });
    });

    describe('semicolon-free initializers (ASI)', () => {
      it('annotates a string const without trailing semicolon (newline boundary)', async () => {
        // const x = 'hello'\nuse(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>\n' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello&#x27;"');
      });

      it('annotates a number const without trailing semicolon (newline boundary)', async () => {
        // const n = 42\nuse(n)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>\n' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="42"');
      });

      it('annotates a string const without trailing semicolon or newline (end of code)', async () => {
        // const x = 'hello'; x  — but no ; at end, just end-of-code
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span> ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello&#x27;"');
      });
    });

    describe('number and boolean const', () => {
      it('annotates a variable reference with its number value', async () => {
        // const n = 42; callFunc(n)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>; ' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="42"');
        expect(output).toContain('>n</span>');
      });

      it('annotates a variable reference with its boolean value', async () => {
        // const b = true; callFunc(b)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">true</span>; ' +
          '<span class="pl-smi">b</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="true"');
        expect(output).toContain('>b</span>');
      });
    });

    describe('object literal with dot access', () => {
      it('annotates a dot-accessed property with its string value', async () => {
        // const obj = { test: 'one' }; callFunc(obj.test)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ test: <span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">test</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;one&#x27;"');
        expect(output).toContain('data-name="obj.test"');
      });

      it('annotates the object itself when no dot access', async () => {
        // const obj = { a: 'one', b: 'two' }; callFunc(obj)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ a: <span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span>, ' +
          'b: <span class="pl-s"><span class="pl-pds">\'</span>two<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="{ a: &#x27;one&#x27;, b: &#x27;two&#x27; }"');
        expect(output).toContain('data-name="obj"');
      });

      it('handles object with number property values', async () => {
        // const obj = { count: 42 }; callFunc(obj.count)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ count: <span class="pl-c1">42</span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">count</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="42"');
        expect(output).toContain('data-name="obj.count"');
      });

      it('does not resolve untracked property on dot access', async () => {
        // const obj = { a: 'one' }; callFunc(obj.b)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ a: <span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">missing</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Dot-access fails for "missing" — falls back to annotating obj with full shape
        expect(output).toContain('data-value="{ a: &#x27;one&#x27; }"');
        expect(output).toContain('data-name="obj"');
      });

      it('does not annotate object shorthand properties as empty object', async () => {
        // const obj = { a }; callFunc(obj)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-smi">a</span> }; ' +
          '<span class="pl-smi">obj</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not annotate mixed shorthand and key-value object as partial shape', async () => {
        // const obj = { a, b: 'y' }; callFunc(obj)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-smi">a</span>, b: ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>y<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('preserves object tracking when semicolons appear in nested function bodies', async () => {
        // const obj = { fn: function() { doStuff(); }, key: 'val' }; callFunc(obj.key)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ fn: <span class="pl-k">function</span>() { <span class="pl-en">doStuff</span>(); }, ' +
          'key: <span class="pl-s"><span class="pl-pds">\'</span>val<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;val&#x27;"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('preserves object tracking when nested const/let/var declarations appear', async () => {
        // const obj = { fn: () => { const t = 'x'; }, key: 'v' }; use(obj.key)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ fn: () =&gt; { <span class="pl-k">const</span> <span class="pl-c1">t</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span>; }, ' +
          'key: <span class="pl-s"><span class="pl-pds">\'</span>v<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;v&#x27;"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('does not leak inner bindings from nested function bodies in object literals', async () => {
        // const obj = { fn: () => { const inner = 'leaked'; }, key: 'v' }; use(inner)
        // `inner` is scoped to the arrow function body — it should NOT resolve outside
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ fn: () =&gt; { <span class="pl-k">const</span> <span class="pl-c1">inner</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>leaked<span class="pl-pds">\'</span></span>; }, ' +
          'key: <span class="pl-s"><span class="pl-pds">\'</span>v<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">inner</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // `inner` should NOT have a data-value because it's scoped to the nested function
        expect(output).not.toContain('data-value="&#x27;leaked&#x27;"');
        // The object property should still be tracked correctly
        expect(output).not.toContain('data-name="inner"');
      });

      it('does not bind inner literal values to outer property names', async () => {
        // const obj = { nested: { a: 'x' }, key: 'v' }; use(obj.nested)
        // The inner `'x'` should NOT be assigned to `nested` as a top-level value.
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ nested: { a: <span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span> }, ' +
          'key: <span class="pl-s"><span class="pl-pds">\'</span>v<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">nested</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // `nested` should NOT have value 'x' — that's from the inner object
        expect(output).not.toContain('data-value="&#x27;x&#x27;"');
        // The outer key `key` should still be tracked
        // But `nested` has no literal value (it's an object), so no data-value
      });

      it('correctly tracks outer properties when inner objects have number values', async () => {
        // const obj = { nested: { count: 42 }, name: 'test' }; use(obj.name)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ nested: { count: <span class="pl-c1">42</span> }, ' +
          'name: <span class="pl-s"><span class="pl-pds">\'</span>test<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">name</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;test&#x27;"');
        expect(output).toContain('data-name="obj.name"');
        // The inner `42` should NOT leak to `nested`
      });

      it('detects object keys emitted as pl-v property spans', async () => {
        // const obj = { key: 'val' }; use(obj.key)
        // where "key" is a <span class="pl-v"> rather than plain text
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-v">key</span>: <span class="pl-s"><span class="pl-pds">\'</span>val<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;val&#x27;"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('detects object keys emitted as pl-c1 linkable spans', async () => {
        // const obj = { key: 42 }; use(obj.key)
        // where "key" is a <span class="pl-c1"> rather than plain text
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-c1">key</span>: <span class="pl-c1">42</span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="42"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('detects object keys emitted as pl-smi spans', async () => {
        // const obj = { key: 'val' }; use(obj.key)
        // where "key" is a <span class="pl-smi"> rather than plain text
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-smi">key</span>: <span class="pl-s"><span class="pl-pds">\'</span>val<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;val&#x27;"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('handles multiple span-tokenized keys in one object', async () => {
        // const obj = { a: 'one', b: 'two' }; use(obj.b)
        // where both "a" and "b" are <span class="pl-v">
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-v">a</span>: <span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-v">b</span>: <span class="pl-s"><span class="pl-pds">\'</span>two<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">b</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;two&#x27;"');
        expect(output).toContain('data-name="obj.b"');
      });

      it('detects span-tokenized keys when the colon is also a keyword span', async () => {
        // const obj = { key: 'val' }; use(obj.key)
        // where "key" is <span class="pl-v"> and ":" is <span class="pl-k">
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-v">key</span><span class="pl-k">:</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>val<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;val&#x27;"');
        expect(output).toContain('data-name="obj.key"');
      });

      it('handles multiple span keys with span colons', async () => {
        // const obj = { a: 'one', b: 'two' }; use(obj.a)
        // where keys and colons are all spans
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ <span class="pl-c1">a</span><span class="pl-k">:</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-c1">b</span><span class="pl-k">:</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>two<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">a</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;one&#x27;"');
        expect(output).toContain('data-name="obj.a"');
      });
    });

    describe('typeValueRefComponent option', () => {
      it('emits a custom component element for string literals', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            typeValueRefComponent: 'TypeValueRef',
          },
        );

        expect(output).toContain('<TypeValueRef');
        expect(output).toContain('value="&#x27;hello&#x27;"');
        expect(output).toContain('name="x"');
        expect(output).toContain('>x</TypeValueRef>');
      });

      it('emits a custom component element for object dot access', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ key: <span class="pl-s"><span class="pl-pds">\'</span>val<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-smi">obj</span>.<span class="pl-smi">key</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            typeValueRefComponent: 'TypeValueRef',
          },
        );

        expect(output).toContain('<TypeValueRef');
        expect(output).toContain('value="&#x27;val&#x27;"');
        expect(output).toContain('name="obj.key"');
      });
    });

    describe('negative cases', () => {
      it('does not track let declarations (mutable)', async () => {
        // let x = 'hello'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">let</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not track var declarations (mutable)', async () => {
        // var x = 'hello'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">var</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('requires linkScope to be enabled', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            linkScope: false,
            linkValues: true,
          },
        );

        // linkScope is false — pl-smi is not resolved at all
        expect(output).toContain('<span class="pl-smi">x</span>');
        expect(output).not.toContain('data-value');
      });

      it('does not annotate when linkValues is off', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            linkValues: false,
          },
        );

        expect(output).not.toContain('data-value');
      });

      it('does not misclassify arrow function bodies as object literals', async () => {
        // const fn = () => { return 1; }; callFunc(fn)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">fn</span> <span class="pl-k">=</span> ' +
          '(<span class="pl-smi">x</span>) <span class="pl-k">=></span> { ' +
          '<span class="pl-k">return</span> <span class="pl-c1">1</span>; }; ' +
          '<span class="pl-smi">fn</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Should NOT produce a value-object binding from the function body
        expect(output).not.toContain('data-value');
      });

      it('does not annotate scalars when only linkArrays is on', async () => {
        // const n = 42; callFunc(n)  — with linkArrays: true, linkValues: false
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>; ' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            linkValues: false,
            linkArrays: true,
          },
        );

        expect(output).not.toContain('data-value');
      });
    });

    describe('interaction with existing linkScope type bindings', () => {
      it('type annotation takes priority over value binding', async () => {
        // const x: TypeA = 'hello'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">TypeA</span> ' +
          '<span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';
        const linkMap = { TypeA: '#type-a' };

        const output = await processWithValues(input, { js: linkMap });

        // Type annotation binding should win (recorded first, and = clears lastDeclaredVarName before value capture)
        expect(output).toContain('<a href="#type-a"');
        expect(output).toContain('>x</a>');
        expect(output).not.toContain('data-value');
      });
    });

    describe('nested expression safety', () => {
      it('does not capture function call arguments as the const value', async () => {
        // const x = fn('hello'); callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-en">fn</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not start array tracking from index access', async () => {
        // const x = foo[0]; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">foo</span>[<span class="pl-c1">0</span>]; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} }, { linkArrays: true });

        expect(output).not.toContain('data-value');
      });

      it('does not capture values from identifier initializers', async () => {
        // const x = otherVar; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">otherVar</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture values from grouped expressions', async () => {
        // const x = ('hello'); callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> (' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('evaluates an arithmetic expression and annotates the reference', async () => {
        // const x = 42 + 1; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span> + <span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="43"');
        expect(output).toContain('data-name="x"');
      });

      it('does not capture the first literal in a ternary expression', async () => {
        // const x = true ? 'a' : 'b'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">true</span> ? ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span> : ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture the first literal in a logical AND expression', async () => {
        // const x = 1 && foo; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> &amp;&amp; <span class="pl-c1">foo</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('evaluates a string concatenation expression and annotates the reference', async () => {
        // const x = 'hello' + ' world'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span> world<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello world&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('does not capture a boolean after unary NOT prefix', async () => {
        // const x = !true; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> !' +
          '<span class="pl-c1">true</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture a number after unary bitwise NOT prefix', async () => {
        // const x = ~1; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ~' +
          '<span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture a number after unary negation prefix', async () => {
        // const x = -1; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> -' +
          '<span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('evaluates a multiline string concatenation and annotates the reference', async () => {
        // const x = 'a'
        //   + 'b'; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span>\n  + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;ab&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('evaluates a multiline arithmetic expression and annotates the reference', async () => {
        // const x = 42
        //   + 1; callFunc(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>\n  + <span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="43"');
        expect(output).toContain('data-name="x"');
      });

      it('evaluates an expression across separate line spans and annotates the reference', async () => {
        // const x = 42 on one line element, + 1; use(x) on the next
        // Simulates syntax highlighters that wrap each line in a <span class="line">
        const input =
          '<code class="language-tsx">' +
          '<span class="line">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>' +
          '</span>\n' +
          '<span class="line">' +
          '+ <span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="43"');
        expect(output).toContain('data-name="x"');
      });

      it('does not capture a literal when the next line continues with dot access', async () => {
        // const x = 'hello'
        //   .toUpperCase(); use(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>\n  ' +
          '.<span class="pl-en">toUpperCase</span>(); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture a literal when the next line continues with bracket access', async () => {
        // const x = 'hello'
        //   [0]; use(x)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>\n  ' +
          '[<span class="pl-c1">0</span>]; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not capture a literal when the next line continues with a call', async () => {
        // const x = fn
        //   ('arg'); use(x)
        // Here `fn` is a pl-en span, `(` starts a call on the next line
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span>\n  ' +
          '(<span class="pl-c1">0</span>); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });
    });

    describe('compound expression evaluation', () => {
      it('wraps arithmetic expression nodes at the definition site', async () => {
        // const x = 2 + 3; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">2</span> + <span class="pl-c1">3</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Definition site: expression nodes wrapped
        expect(output).toContain('data-value="5"');
        expect(output).toContain('data-name="x"');
        // Reference site also annotated
        const matches = output.match(/data-value="5"/g);
        expect(matches).toHaveLength(2);
      });

      it('evaluates multiplication before addition', async () => {
        // const x = 2 + 3 * 4; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">2</span> + <span class="pl-c1">3</span> * <span class="pl-c1">4</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="14"');
      });

      it('evaluates subtraction', async () => {
        // const x = 10 - 3; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">10</span> - <span class="pl-c1">3</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="7"');
      });

      it('evaluates division', async () => {
        // const x = 12 / 4; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">12</span> / <span class="pl-c1">4</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
      });

      it('evaluates string concatenation with +', async () => {
        // const x = 'foo' + 'bar'; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>foo<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>bar<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;foobar&#x27;"');
      });

      it('evaluates mixed number + string concatenation', async () => {
        // const x = 'item-' + 3; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>item-<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-c1">3</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;item-3&#x27;"');
      });

      it('resolves a tracked variable reference in an expression', async () => {
        // const a = 10; const b = a + 5; b
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">10</span>; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> ' +
          '<span class="pl-smi">a</span> + <span class="pl-c1">5</span>; ' +
          '<span class="pl-smi">b</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="15"');
        expect(output).toContain('data-name="b"');
      });

      it('uses typeValueRefComponent at expression definition site', async () => {
        // const x = 1 + 2; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(
          input,
          { js: {} },
          {
            typeValueRefComponent: 'ValueRef',
          },
        );

        // Definition site wrapper uses the custom component
        expect(output).toContain('<ValueRef');
        expect(output).toContain('value="3"');
        expect(output).toContain('name="x"');
      });

      it('does not evaluate when non-evaluable operators are present', async () => {
        // const x = 1 % 2; x (modulo is not evaluable)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> % <span class="pl-c1">2</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('preserves the semicolon outside the wrapper', async () => {
        // const x = 1 + 2;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>;' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // The `;` should be outside the value-ref wrapper
        expect(output).toContain('</span>;');
      });

      it('keeps the newline outside the wrapper for ASI-terminated expressions', async () => {
        // const n = 1 + 2
        // n
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>\n' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // The newline should be outside the definition-site value-ref wrapper
        expect(output).toContain('</span>\n');
        expect(output).not.toMatch(/data-value="3"[^>]*>[^<]*\n/);
      });

      it('flushes an expression at newline (ASI) so references on the next line resolve', async () => {
        // const n = 1 + 2
        // n
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>\n' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
        expect(output).toContain('data-name="n"');
      });

      it('does not flush an expression when the next line continues with dot access', async () => {
        // const x = 1 + 2
        //   .toString(); x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>\n  ' +
          '.<span class="pl-en">toString</span>(); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-name="x"');
        expect(output).not.toContain('data-value="3"');
      });

      it('does not flush an expression when the next line continues with bracket access', async () => {
        // const x = 'a' + 'b'
        //   [0]; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>\n  ' +
          '[<span class="pl-c1">0</span>]; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-name="x"');
        expect(output).not.toContain('data-value="&#x27;ab&#x27;"');
      });

      it('does not flush an expression when the next line continues with a call', async () => {
        // const x = 1 + 2
        //   (0); x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>\n  ' +
          '(<span class="pl-c1">0</span>); ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-name="x"');
        expect(output).not.toContain('data-value="3"');
      });

      it('does not flush at newline when the last token is an operator (continuation)', async () => {
        // const x = 1 +
        //   2; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> +\n  <span class="pl-c1">2</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
      });

      it('does not evaluate consecutive operators like ++', async () => {
        // const x = 'a' ++ 'b'; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span> ++ ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('does not evaluate consecutive operators like +-', async () => {
        // const x = 1 +- 2; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> +- <span class="pl-c1">2</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('handles numeric separators by stripping underscores', async () => {
        // const n = 1_000 + 1; n
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1_000</span> + <span class="pl-c1">1</span>; ' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="1001"');
      });

      it('handles a standalone numeric-separated literal', async () => {
        // const n = 1_000; n
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1_000</span>; ' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="1_000"');
        expect(output).toContain('data-name="n"');
      });

      it('does not evaluate expressions containing object-binding operands', async () => {
        // const obj = { a: 'x' }; const y = 'z' + obj; callFunc(y)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> ' +
          '{ a: <span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span> }; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">y</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>z<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-smi">obj</span>; ' +
          '<span class="pl-smi">y</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // y should NOT have a data-value of "'z{ a: 'x' }'" (concatenated object shape)
        expect(output).not.toContain('data-name="y"');
      });

      it('wraps EOF-terminated expressions with definition-site annotation', async () => {
        // const n = 1 + 2 (no semicolon, no newline — block ends)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
        expect(output).toContain('data-name="n"');
      });

      it('wraps EOF-terminated expressions inside line wrappers at the definition site', async () => {
        // <span class="line">const n = 1 + 2</span> (EOF)
        const input =
          '<code class="language-tsx">' +
          '<span class="line">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span>' +
          '</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
        expect(output).toContain('data-name="n"');
        expect(output).toContain('<span class="line">');
        expect(output).toContain('<span data-value="3" data-name="n">');
      });

      it('does not evaluate expressions containing array-binding operands', async () => {
        // const arr = ['a']; const x = arr + 'b'; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> ' +
          '[<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-smi">arr</span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} }, { linkArrays: true });

        // x should NOT have a data-value — array bindings cannot participate in expressions
        expect(output).not.toContain('data-name="x"');
      });

      it('does not seed a literal candidate from an array-valued binding', async () => {
        // const arr = ['a']; const x = arr; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> ' +
          '[<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-smi">arr</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} }, { linkArrays: true });

        // x should NOT have a data-value — array values should not seed literal candidates
        expect(output).not.toContain('data-name="x"');
      });

      it('commits an ASI-terminated expression before a line comment', async () => {
        // const n = 1 + 2 // comment\nn
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c1">2</span> ' +
          '<span class="pl-c">// comment</span>\n' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
        expect(output).toContain('data-name="n"');
        expect(output).toContain('</span><span class="pl-c">// comment</span>');
      });

      it('keeps an inline block comment inside the wrapped expression region', async () => {
        // const n = 1 + /* comment */ 2; n
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-c">/* comment */</span> <span class="pl-c1">2</span>; ' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="3"');
        expect(output).toContain('data-name="n"');
        expect(output).toContain(
          '<span data-value="3" data-name="n"><span class="pl-c1">1</span> + <span class="pl-c">/* comment */</span> <span class="pl-c1">2</span></span>; ',
        );
      });

      it('commits a literal candidate before a line comment', async () => {
        // const n = 42 // comment\nn
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">n</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">42</span> ' +
          '<span class="pl-c">// comment</span>\n' +
          '<span class="pl-smi">n</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="42"');
        expect(output).toContain('data-name="n"');
      });
    });

    describe('template literals', () => {
      it('tracks a simple template literal (no interpolation) as a string value', async () => {
        // const x = `hello`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">`</span>hello<span class="pl-pds">`</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('resolves an interpolated tracked variable', async () => {
        // const a = 'world'; const x = `hello ${a}`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>world<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>hello ' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-s1">a</span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // 'hello ' + 'world' → 'hello world'
        expect(output).toContain('data-value="&#x27;hello world&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('partially evaluates a template with untracked variable', async () => {
        // const x = `prefix-${name}-suffix`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>prefix-' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-s1">name</span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '-suffix<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Partial: 'prefix-' + name + '-suffix'
        expect(output).toContain('data-value="&#x27;prefix-&#x27; + name + &#x27;-suffix&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('resolves an interpolated tracked variable with whitespace text inside interpolation', async () => {
        // const name = 'world'; const x = `hello ${ name }`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">name</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>world<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>hello ' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          ' ' +
          '<span class="pl-s1">name</span>' +
          ' ' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello world&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('resolves an interpolated tracked variable when the identifier span includes padding whitespace', async () => {
        // const name = 'world'; const x = `hello ${ name }`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">name</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>world<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>hello ' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-s1"> name </span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello world&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('does not absorb a trailing line comment into the template literal wrapper', async () => {
        // const a = 'world'; const x = `hello ${a}` // comment\nx
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>world<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>hello ' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-s1">a</span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span> ' +
          '<span class="pl-c">// comment</span>\n' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        expect(output).toContain('data-value="&#x27;hello world&#x27;"');
        expect(output).toContain('data-name="x"');
        // Comment must be outside the value-ref wrapper
        expect(output).toContain('</span><span class="pl-c">// comment</span>');
      });

      it('bails on complex interpolation expressions', async () => {
        // const x = `${a + b}`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-s1">a </span>' +
          '<span class="pl-k">+</span>' +
          '<span class="pl-s1"> b</span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Should not track — expression is too complex
        expect(output).not.toContain('data-value');
      });

      it('bails on member access interpolation', async () => {
        // const x = `${obj.prop}`; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s">' +
          '<span class="pl-pds">`</span>' +
          '<span class="pl-pse"><span class="pl-s1">${</span></span>' +
          '<span class="pl-smi">obj</span>' +
          '<span class="pl-s1">.</span>' +
          '<span class="pl-smi">prop</span>' +
          '<span class="pl-pse"><span class="pl-s1">}</span></span>' +
          '<span class="pl-pds">`</span>' +
          '</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Should not track — member access is too complex
        expect(output).not.toContain('data-value');
      });
    });

    describe('partial expression evaluation', () => {
      it('collapses adjacent string literals around an unresolved variable', async () => {
        // const x = 'a' + 'b' + test + 'c' + 'd'; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-smi">test</span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>c<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>d<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // 'ab' + test + 'cd'
        expect(output).toContain('data-value="&#x27;ab&#x27; + test + &#x27;cd&#x27;"');
        expect(output).toContain('data-name="x"');
      });

      it('returns null for variables in pure numeric context', async () => {
        // const x = 1 + y * 3; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-c1">1</span> + <span class="pl-smi">y</span> * <span class="pl-c1">3</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, { js: {} });

        // Cannot partially evaluate numeric expressions with variables
        expect(output).not.toContain('data-value');
      });

      it('propagates refs for type-linked variables in partial expressions', async () => {
        // type Color = ...; const c: Color = ...; const x = 'prefix-' + c; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">type</span> <span class="pl-en">Color</span> <span class="pl-k">=</span> ...\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">c</span><span class="pl-k">:</span> ' +
          '<span class="pl-en">Color</span> <span class="pl-k">=</span> ...\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>prefix-<span class="pl-pds">\'</span></span> + ' +
          '<span class="pl-smi">c</span>; ' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithValues(input, {
          js: { Color: '/api/color' },
        });

        // Partial expression: 'prefix-' + c
        expect(output).toContain('data-value="&#x27;prefix-&#x27; + c"');
        expect(output).toContain('data-name="x"');
        // Refs map should contain c → /api/color
        expect(output).toContain('data-refs=');
        expect(output).toContain('/api/color');
      });
    });
  });

  describe('linkArrays option', () => {
    async function processWithArrays(
      input: string,
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
      opts?: {
        linkScope?: boolean;
        linkValues?: boolean;
        linkArrays?: boolean;
        typeValueRefComponent?: string;
      },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, {
          linkMap,
          linkScope: opts?.linkScope ?? true,
          linkArrays: opts?.linkArrays ?? true,
          linkValues: opts?.linkValues,
          ...opts,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('simple array literal', () => {
      it('annotates a variable with its array value', async () => {
        // const arr = ['one', 'two', 'three']; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>two<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>three<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} });

        expect(output).toContain(
          'data-value="[&#x27;one&#x27;, &#x27;two&#x27;, &#x27;three&#x27;]"',
        );
        expect(output).toContain('data-name="arr"');
      });
    });

    describe('array with variable composition', () => {
      it('resolves tracked variable values in arrays', async () => {
        // const a = 'x'; const b = 'y'; const arr = [a, b]; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>y<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '<span class="pl-smi">a</span>, <span class="pl-smi">b</span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} }, { linkValues: true });

        expect(output).toContain('data-value="[&#x27;x&#x27;, &#x27;y&#x27;]"');
        expect(output).toContain('data-name="arr"');
      });
    });

    describe('array with mixed types', () => {
      it('handles mixed string and number elements', async () => {
        // const arr = ['hello', 42]; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-c1">42</span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} });

        expect(output).toContain('data-value="[&#x27;hello&#x27;, 42]"');
      });
    });

    describe('array with spread operator', () => {
      it('does not track array containing spread of untracked variable', async () => {
        // const arr = [...a]; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '...<span class="pl-smi">a</span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} });

        expect(output).not.toContain('data-value');
      });

      it('inlines elements from a tracked array const via spread', async () => {
        // const a = ['x', 'y']; const arr = [...a]; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>y<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '...<span class="pl-smi">a</span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} }, { linkValues: true });

        expect(output).toContain('data-value="[&#x27;x&#x27;, &#x27;y&#x27;]"');
        expect(output).toContain('data-name="arr"');
      });

      it('inlines spread alongside additional literal elements', async () => {
        // const a = ['x']; const arr = [...a, 'z']; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>x<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '...<span class="pl-smi">a</span>, ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>z<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} }, { linkValues: true });

        expect(output).toContain('data-value="[&#x27;x&#x27;, &#x27;z&#x27;]"');
        expect(output).toContain('data-name="arr"');
      });

      it('does not track when spreading a non-array value binding', async () => {
        // const a = 'hello'; const arr = [...a]; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '...<span class="pl-smi">a</span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} }, { linkValues: true });

        expect(output).not.toContain('data-name="arr"');
      });

      it('does not track array with spread of a string literal', async () => {
        // const arr = [...'abc']; callFunc(arr)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '...<span class="pl-s"><span class="pl-pds">\'</span>abc<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} });

        expect(output).not.toContain('data-value');
      });
    });

    describe('negative cases', () => {
      it('does not track arrays when linkArrays is off', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>one<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(input, { js: {} }, { linkArrays: false });

        expect(output).not.toContain('data-value');
      });
    });

    describe('typeValueRefComponent option', () => {
      it('emits a custom component for array references', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">arr</span> <span class="pl-k">=</span> [' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>]; ' +
          '<span class="pl-smi">arr</span>' +
          '</code>';

        const output = await processWithArrays(
          input,
          { js: {} },
          {
            typeValueRefComponent: 'TypeValueRef',
          },
        );

        expect(output).toContain('<TypeValueRef');
        expect(output).toContain('value="[&#x27;a&#x27;, &#x27;b&#x27;]"');
        expect(output).toContain('name="arr"');
      });
    });
  });

  describe('moduleLinkMap option', () => {
    async function processWithModules(
      input: string,
      linkMap: { js?: Record<string, string>; css?: Record<string, string> },
      opts: {
        moduleLinkMap: Record<string, ModuleLinkMapEntry>;
        defaultImportSlug?: string;
        typeRefComponent?: string;
        linkScope?: boolean;
      },
    ): Promise<string> {
      const { moduleLinkMap, ...rest } = opts;
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, {
          linkMap,
          moduleLinkMap: { js: moduleLinkMap },
          ...rest,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    function parseDataImports(html: string): Record<string, unknown> {
      const match = html.match(/data-imports="([^"]*)"/)?.[1];
      if (!match) {
        return {};
      }
      return JSON.parse(match.replace(/&#x22;/g, '"'));
    }

    // HTML building blocks for import statements (matching Starry Night output):
    // pl-k: keywords (import, from, as, type, default)
    // pl-smi: identifiers (named/default/namespace imports AND variable references)
    // pl-s: string literal (module specifier), pl-pds: quote delimiters
    // pl-c1: constants and JSX tags in usage context

    describe('named imports', () => {
      it('links the module specifier string to the module href', async () => {
        // import { test } from '@foo'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // Module string should be wrapped in a link
        expect(output).toContain('<a href="/docs/foo"');
        expect(output).toContain('@foo');
      });

      it('registers imported identifiers in the linkMap for pl-c1 usage', async () => {
        // import { test } from '@foo'; <test />
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">test</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // The usage of `test` after the import should be linked
        expect(output).toContain('<a href="/docs/foo#test-api"');
      });

      it('links the module specifier and records data-imports for star re-exports', async () => {
        // export * from './module';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> * ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./module<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              './module': {
                href: '/docs/module',
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/module"');
        expect(parseDataImports(output)).toEqual({
          './module': { link: '/docs/module', exports: [] },
        });
      });

      it('registers imported identifiers in scope for pl-smi usage', async () => {
        // import { test } from '@foo'; test()
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">test</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // The pl-smi usage of `test` should be linked via scope
        expect(output).toContain('<a href="/docs/foo#test-api"');
      });

      it('handles multiple named imports', async () => {
        // import { alpha, beta } from '@foo'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { ' +
          '<span class="pl-smi">alpha</span>, ' +
          '<span class="pl-smi">beta</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">alpha</span> <span class="pl-c1">beta</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: {
                  alpha: { slug: '#alpha' },
                  beta: { slug: '#beta' },
                },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo#alpha"');
        expect(output).toContain('<a href="/docs/foo#beta"');
      });

      it('uses the export title when provided', async () => {
        // import { test } from '@foo'; test()
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">test</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api', title: 'TestFunc' } },
              },
            },
            typeRefComponent: 'TypeRef',
          },
        );

        expect(output).toContain('name="TestFunc"');
      });
    });

    describe('aliased imports', () => {
      it('tracks aliased imports under the local name', async () => {
        // import { test as myTest } from '@foo'; myTest()
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> ' +
          '<span class="pl-k">as</span> <span class="pl-smi">myTest</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">myTest</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // Should be linked under the local name `myTest` with the original slug
        expect(output).toContain('<a href="/docs/foo#test-api"');
      });
    });

    describe('default imports', () => {
      it('links default import with module-level defaultSlug', async () => {
        // import React from '@foo'; React
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> <span class="pl-smi">React</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">React</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                defaultSlug: '#default',
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo#default"');
      });

      it('links default import with global defaultImportSlug', async () => {
        // import React from '@foo'; React
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> <span class="pl-smi">React</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">React</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
            defaultImportSlug: '#api',
          },
        );

        expect(output).toContain('<a href="/docs/foo#api"');
      });

      it('links { default as Foo } using defaultSlug', async () => {
        // import { default as Foo } from '@foo'; Foo
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-k">default</span> ' +
          '<span class="pl-k">as</span> <span class="pl-smi">Foo</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">Foo</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                defaultSlug: '#default',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo#default"');
      });

      it('links { default as Foo } with global defaultImportSlug', async () => {
        // import { default as Foo } from '@foo'; Foo
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-k">default</span> ' +
          '<span class="pl-k">as</span> <span class="pl-smi">Foo</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">Foo</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
            defaultImportSlug: '#api',
          },
        );

        expect(output).toContain('<a href="/docs/foo#api"');
      });

      it('links { default as Foo } alongside named imports', async () => {
        // import { default as Foo, test } from '@foo'; Foo test
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-k">default</span> ' +
          '<span class="pl-k">as</span> <span class="pl-smi">Foo</span>, ' +
          '<span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">Foo</span> <span class="pl-smi">test</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                defaultSlug: '#default',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // default as Foo → uses defaultSlug
        expect(output).toContain('<a href="/docs/foo#default"');
        // test → uses exports
        expect(output).toContain('<a href="/docs/foo#test-api"');
      });
    });

    describe('namespace imports', () => {
      it('resolves namespace dot-access against module exports', async () => {
        // import * as NS from '@foo'; NS.test
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> * ' +
          '<span class="pl-k">as</span> <span class="pl-smi">NS</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">NS</span>.<span class="pl-smi">test</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // NS.test should be linked via module dot-access
        expect(output).toContain('<a href="/docs/foo#test-api"');
      });

      it('links the namespace identifier itself with defaultSlug', async () => {
        // import * as NS from '@foo'; NS
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> * ' +
          '<span class="pl-k">as</span> <span class="pl-smi">NS</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-smi">NS</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                defaultSlug: '#ns-api',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // NS without dot-access should link to the module page with defaultSlug
        expect(output).toContain('<a href="/docs/foo#ns-api"');
      });
    });

    describe('type-only imports', () => {
      it('links type-only named imports', async () => {
        // import type { MyType } from '@foo'; MyType
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> <span class="pl-k">type</span> { ' +
          '<span class="pl-smi">MyType</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">MyType</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { MyType: { slug: '#my-type' } },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo#my-type"');
      });

      it('registers both type and value named imports from one clause', async () => {
        // import { type MyType, myValue } from '@foo'; MyType; myValue
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { ' +
          '<span class="pl-k">type</span> <span class="pl-smi">MyType</span>, ' +
          '<span class="pl-smi">myValue</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">MyType</span>; ' +
          '<span class="pl-c1">myValue</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: {
                  MyType: { slug: '#my-type' },
                  myValue: { slug: '#my-value' },
                },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo#my-type"');
        expect(output).toContain('<a href="/docs/foo#my-value"');
      });
    });

    describe('dynamic imports', () => {
      it('links the module string in a dynamic import', async () => {
        // import('@foo')
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo"');
      });

      it('does not link strings in computed dynamic imports', async () => {
        // import('@foo' + bar)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          ' + <span class="pl-smi">bar</span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Computed expression — '@foo' is not the actual module specifier
        expect(output).not.toContain('<a href="/docs/foo"');
      });

      it('does not link strings in dynamic imports with import assertions', async () => {
        // import('@foo', { assert: { type: 'json' } })
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          ', { <span class="pl-smi">assert</span>: { <span class="pl-smi">type</span>: ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>json<span class="pl-pds">\'</span></span>' +
          ' } })' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Multi-argument dynamic import — treated as computed
        expect(output).not.toContain('<a href="/docs/foo"');
      });

      it('links a parenthesized dynamic import specifier', async () => {
        // import(('@foo'))
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>((' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '))' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Extra parens are just grouping — semantically identical to import('@foo')
        expect(output).toContain('<a href="/docs/foo"');
      });

      it('does not link a comment-annotated dynamic import specifier', async () => {
        // import(/* webpackChunkName */ '@foo')
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-c">/* webpackChunkName */</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Comment element inside parens marks the import as computed
        expect(output).not.toContain('<a href="/docs/foo"');
      });
    });

    describe('non-matching modules', () => {
      it('does not modify imports for modules not in the map', async () => {
        // import { test } from '@bar'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // Module string should NOT be wrapped in a link
        expect(output).not.toContain('<a href=');
        expect(output).toContain('@bar');
      });

      it('does not link exports not present in the module exports map', async () => {
        // import { unknown } from '@foo'; unknown
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">unknown</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">unknown</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        // Module string IS linked, but the imported identifier is NOT
        expect(output).toContain('<a href="/docs/foo"');
        // Count anchor tags — only the module string link
        const anchors = output.match(/<a /g) ?? [];
        expect(anchors.length).toBe(1);
      });
    });

    describe('side-effect imports', () => {
      it('links the module specifier in a side-effect import', async () => {
        // import '@foo'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': {
                href: '/docs/foo',
                exports: { test: { slug: '#test-api' } },
              },
            },
          },
        );

        expect(output).toContain('<a href="/docs/foo"');
      });

      it('resets import state after a side-effect import so later identifiers link normally', async () => {
        // import '@foo'; Trigger
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">Trigger</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: { Trigger: '#trigger' } },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Trigger should still be linked via the regular linkMap
        expect(output).toContain('<a href="#trigger"');
      });

      it('resets import state even when the module is not in the map', async () => {
        // import '@unknown'; Trigger
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@unknown<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">Trigger</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: { Trigger: '#trigger' } },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // Trigger should still be linked normally
        expect(output).toContain('<a href="#trigger"');
      });

      it('resets import state via semicolon fail-safe even without moduleLinkMap', async () => {
        // import '@foo'; Trigger (no moduleLinkMap configured)
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-c1">Trigger</span>' +
          '</code>';

        const output = await processHtml(input, { js: { Trigger: '#trigger' } });

        // Trigger should still be linked normally
        expect(output).toContain('<a href="#trigger"');
      });

      it('does not treat import.meta as a module import', async () => {
        // import.meta.url\nconst s = '@foo'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>.<span class="pl-c1">meta</span>.<span class="pl-smi">url</span>\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">s</span> = ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          { js: {} },
          {
            moduleLinkMap: {
              '@foo': { href: '/docs/foo' },
            },
          },
        );

        // The string '@foo' should NOT be linked — it's a const value, not an import specifier
        expect(output).not.toContain('<a href="/docs/foo"');
      });
    });

    describe('linkMap mutation', () => {
      it('does not mutate the original linkMap object', async () => {
        const linkMap = { js: { existing: '#existing' } };
        const original = { ...linkMap.js };

        // import { test } from '@foo'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '</code>';

        await processWithModules(input, linkMap, {
          moduleLinkMap: {
            '@foo': {
              href: '/docs/foo',
              exports: { test: { slug: '#test-api' } },
            },
          },
        });

        // Original linkMap should not be mutated (no `test` key added)
        expect(linkMap.js).toEqual(original);
      });
    });

    describe('import shadowing by local declarations', () => {
      it('local typed const shadows imported name for pl-c1 usage', async () => {
        // import { Button } from '@base'; const Button: LocalButton = styled('button'); <Button />
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base<span class="pl-pds">\'</span></span>\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">Button</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">LocalButton</span> = styled();\n' +
          '&lt;<span class="pl-c1">Button</span> /&gt;' +
          '</code>';

        const linkMap = { js: { LocalButton: '#local-button' } };
        const output = await processWithModules(input, linkMap, {
          moduleLinkMap: {
            '@base': {
              href: '/base',
              exports: { Button: { slug: '#button-api' } },
            },
          },
          linkScope: true,
        });

        // The import specifier string should still be linked
        expect(output).toContain('<a href="/base"');
        // The <Button /> usage should link to LocalButton (shadowing the import)
        expect(output).toContain('<a href="#local-button"');
        // Should NOT link to the import's export slug
        expect(output).not.toContain('<a href="/base#button-api">Button</a>');
      });

      it('untyped local const shadows imported name (uncertain provenance)', async () => {
        // import { Button } from '@base'; const Button = styled(); <Button />
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base<span class="pl-pds">\'</span></span>\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">Button</span> <span class="pl-k">=</span> styled();\n' +
          '&lt;<span class="pl-c1">Button</span> /&gt;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base': {
                href: '/base',
                exports: { Button: { slug: '#button-api' } },
              },
            },
          },
        );

        // The import specifier string should still be linked
        expect(output).toContain('<a href="/base"');
        // <Button /> should NOT be linked — provenance is uncertain
        expect(output).not.toContain('<a href="/base#button-api">Button</a>');
        // The JSX usage should remain as a plain span
        expect(output).toContain('&#x3C;<span class="pl-c1">Button</span>');
      });

      it('import binding is used when no local shadow exists', async () => {
        // import { Button } from '@base'; <Button />
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base<span class="pl-pds">\'</span></span>\n' +
          '&lt;<span class="pl-c1">Button</span> /&gt;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base': {
                href: '/base',
                exports: { Button: { slug: '#button-api' } },
              },
            },
          },
        );

        // <Button /> should link to the imported module export
        expect(output).toContain('<a href="/base#button-api"');
        expect(output).toContain('>Button</a>');
      });

      it('imported type used in type annotation resolves via scope', async () => {
        // import { TypeA } from '@mod'; const x: TypeA = v; x
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">TypeA</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@mod<span class="pl-pds">\'</span></span>\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">TypeA</span> <span class="pl-k">=</span> v;\n' +
          '<span class="pl-smi">x</span>' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@mod': {
                href: '/mod',
                exports: { TypeA: { slug: '#type-a' } },
              },
            },
            linkScope: true,
          },
        );

        // `x` (pl-smi) should be linked via scope to TypeA's href
        expect(output).toContain('<a href="/mod#type-a"');
        expect(output).toContain('>x</a>');
      });
    });

    describe('data-import annotation for unresolved modules', () => {
      it('adds data-import to a static import specifier that has no matching entry', async () => {
        // import { test } from '@bar'  — @bar not in moduleLinkMap
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@foo': { href: '/docs/foo' } },
          },
        );

        expect(output).not.toContain('<a');
        expect(output).toContain('data-import="@bar"');
      });

      it('adds data-import to a side-effect import specifier that has no matching entry', async () => {
        // import '@bar'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@foo': { href: '/docs/foo' } },
          },
        );

        expect(output).not.toContain('<a');
        expect(output).toContain('data-import="@bar"');
      });

      it('adds data-import to a dynamic import specifier that has no matching entry', async () => {
        // const x = import('@bar')
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> x = <span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@foo': { href: '/docs/foo' } },
          },
        );

        expect(output).not.toContain('<a');
        expect(output).toContain('data-import="@bar"');
      });

      it('adds data-import to a CSS @import specifier that has no matching entry', async () => {
        // @import './bar.css';
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./bar.css<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, {
            linkMap: {},
            moduleLinkMap: { css: { './foo.css': { href: '/docs/foo' } } },
          })
          .use(rehypeStringify)
          .process(input);

        const output = String(result);
        expect(output).not.toContain('<a');
        expect(output).toContain('data-import="./bar.css"');
      });

      it('does not add data-import when the specifier matches', async () => {
        // import { test } from '@foo'  — @foo IS in moduleLinkMap
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@foo': { href: '/docs/foo' } },
          },
        );

        expect(output).toContain('<a href="/docs/foo"');
        expect(output).not.toContain('data-import=');
      });

      it('does not add data-import when no moduleLinkMap is provided', async () => {
        // import { test } from '@bar' — no moduleLinkMap at all
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">test</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          '</code>';

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, { linkMap: {} })
          .use(rehypeStringify)
          .process(input);

        expect(String(result)).not.toContain('data-import=');
      });

      it('does not add data-import for computed dynamic imports', async () => {
        // import('@pkg/' + name) — computed expression, not a static specifier
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@pkg/<span class="pl-pds">\'</span></span>' +
          ' + <span class="pl-smi">name</span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@foo': { href: '/docs/foo' } },
          },
        );

        expect(output).not.toContain('data-import=');
      });

      it('does not add data-import for dynamic imports with multiple strings', async () => {
        // import('@foo' + '@bar') — two strings, computed expression
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>' +
          ' + ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@bar<span class="pl-pds">\'</span></span>' +
          ')' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: { '@baz': { href: '/docs/baz' } },
          },
        );

        expect(output).not.toContain('data-import=');
      });
    });

    describe('data-imports attribute', () => {
      it('collects named imports as JSON on the code element', async () => {
        // import { Button, Switch } from '@base-ui/react'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span>, <span class="pl-smi">Switch</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': {
                href: '/base',
                exports: {
                  Button: { slug: '#button-api', title: 'Button' },
                  Switch: { slug: '#switch-api', title: 'Switch' },
                },
              },
            },
            linkScope: true,
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react': {
            link: '/base',
            exports: [
              { slug: '#button-api', title: 'Button' },
              { slug: '#switch-api', title: 'Switch' },
            ],
          },
        });
      });

      it('collects default imports', async () => {
        // import React from 'react'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> <span class="pl-smi">React</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>react<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              react: { href: '/react' },
            },
            defaultImportSlug: '#default',
            linkScope: true,
          },
        );

        expect(parseDataImports(output)).toEqual({
          react: {
            link: '/react',
            exports: [{ slug: '#default', title: 'React' }],
          },
        });
      });

      it('collects multiple modules', async () => {
        // import { Button } from '@base-ui/react'\nimport { styled } from '@emotion/styled'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">import</span> { <span class="pl-smi">styled</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@emotion/styled<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': {
                href: '/base',
                exports: { Button: { slug: '#button-api', title: 'Button' } },
              },
              '@emotion/styled': {
                href: '/emotion',
                exports: { styled: { slug: '#styled-api' } },
              },
            },
            linkScope: true,
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react': {
            link: '/base',
            exports: [{ slug: '#button-api', title: 'Button' }],
          },
          '@emotion/styled': {
            link: '/emotion',
            exports: [{ slug: '#styled-api', title: 'styled' }],
          },
        });
      });

      it('collects dynamic imports', async () => {
        // const mod = await import('@base-ui/react')
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-smi">mod</span> <span class="pl-k">=</span> ' +
          '<span class="pl-k">await</span> ' +
          '<span class="pl-k">import</span>(' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react<span class="pl-pds">\'</span></span>)' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': {
                href: '/base',
                exports: { Button: { slug: '#button-api' } },
              },
            },
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react': {
            link: '/base',
            exports: [],
          },
        });
      });

      it('does not include unresolved imports in data-imports', async () => {
        // import { Foo } from 'unknown-module'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Foo</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>unknown-module<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': {
                href: '/base',
                exports: { Button: { slug: '#button-api' } },
              },
            },
            linkScope: true,
          },
        );

        expect(output).not.toContain('data-imports=');
        expect(output).toContain('data-import="unknown-module"');
      });

      it('sets data-imports-missing for unresolved modules', async () => {
        // import { Foo } from 'unknown-module'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Foo</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>unknown-module<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': { href: '/base' },
            },
            linkScope: true,
          },
        );

        const match = output.match(/data-imports-missing="([^"]*)"/)?.[1];
        const parsed = JSON.parse((match ?? '[]').replace(/&#x22;/g, '"'));
        expect(parsed).toEqual(['unknown-module']);
      });

      it('sets both data-imports and data-imports-missing for mixed imports', async () => {
        // import { Button } from '@base-ui/react'\nimport { Foo } from 'unknown'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Button</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">import</span> { <span class="pl-smi">Foo</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>unknown<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': {
                href: '/base',
                exports: { Button: { slug: '#button-api', title: 'Button' } },
              },
            },
            linkScope: true,
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react': {
            link: '/base',
            exports: [{ slug: '#button-api', title: 'Button' }],
          },
        });

        const missingMatch = output.match(/data-imports-missing="([^"]*)"/)?.[1];
        const missing = JSON.parse((missingMatch ?? '[]').replace(/&#x22;/g, '"'));
        expect(missing).toEqual(['unknown']);
      });

      it('collects side-effect imports with no exports', async () => {
        // import '@base-ui/react/styles'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react/styles<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react/styles': { href: '/base/styles' },
            },
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react/styles': {
            link: '/base/styles',
            exports: [],
          },
        });
      });

      it('uses the local alias as title for { default as Foo }', async () => {
        // import { default as Btn } from '@base-ui/react'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> { <span class="pl-k">default</span> <span class="pl-k">as</span> <span class="pl-smi">Btn</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@base-ui/react<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              '@base-ui/react': { href: '/base' },
            },
            defaultImportSlug: '#api',
            linkScope: true,
          },
        );

        expect(parseDataImports(output)).toEqual({
          '@base-ui/react': {
            link: '/base',
            exports: [{ slug: '#api', title: 'Btn' }],
          },
        });
      });

      it('deduplicates by slug, keeping the first alias', async () => {
        // import Foo from 'pkg'\nimport { default as Bar } from 'pkg'
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">import</span> <span class="pl-smi">Foo</span> ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>pkg<span class="pl-pds">\'</span></span>;\n' +
          '<span class="pl-k">import</span> { <span class="pl-k">default</span> <span class="pl-k">as</span> <span class="pl-smi">Bar</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>pkg<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithModules(
          input,
          {},
          {
            moduleLinkMap: {
              pkg: { href: '/pkg' },
            },
            defaultImportSlug: '#default',
            linkScope: true,
          },
        );

        // Same slug — only the first import's title ("Foo") is kept
        expect(parseDataImports(output)).toEqual({
          pkg: {
            link: '/pkg',
            exports: [{ slug: '#default', title: 'Foo' }],
          },
        });
      });
    });

    describe('CSS @import', () => {
      async function processWithCssModules(
        input: string,
        moduleLinkMap: Record<string, { href: string }>,
      ): Promise<string> {
        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, {
            linkMap: {},
            moduleLinkMap: { css: moduleLinkMap },
          })
          .use(rehypeStringify)
          .process(input);

        return String(result);
      }

      it("links the string in @import './foo.css'", async () => {
        // @import './foo.css';
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./foo.css<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithCssModules(input, {
          './foo.css': { href: '/docs/foo' },
        });

        expect(output).toContain('<a href="/docs/foo"');
        expect(output).toContain('./foo.css');
      });

      it('links the string in @import url("./foo.css")', async () => {
        // @import url("./foo.css");
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-c1">url</span>(' +
          '<span class="pl-s"><span class="pl-pds">"</span>./foo.css<span class="pl-pds">"</span></span>);' +
          '</code>';

        const output = await processWithCssModules(input, {
          './foo.css': { href: '/docs/foo' },
        });

        expect(output).toContain('<a href="/docs/foo"');
        expect(output).toContain('./foo.css');
      });

      it('does not link non-matching module specifiers', async () => {
        // @import './bar.css';
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./bar.css<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processWithCssModules(input, {
          './foo.css': { href: '/docs/foo' },
        });

        expect(output).not.toContain('<a');
      });

      it('handles @import with layer clause', async () => {
        // @import './foo.css' layer(base);
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./foo.css<span class="pl-pds">\'</span></span> layer(base);' +
          '</code>';

        const output = await processWithCssModules(input, {
          './foo.css': { href: '/docs/foo' },
        });

        expect(output).toContain('<a href="/docs/foo"');
      });

      it('does not link when moduleLinkMap has no css key', async () => {
        // @import './foo.css'; with only js moduleLinkMap
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./foo.css<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, {
            linkMap: {},
            moduleLinkMap: { js: { './foo.css': { href: '/docs/foo' } } },
          })
          .use(rehypeStringify)
          .process(input);

        expect(String(result)).not.toContain('<a');
      });

      it('does not treat url as a CSS property owner when url is in linkMap', async () => {
        // @import url("./foo.css"); with `url` in the CSS linkMap
        const input =
          '<code class="language-css">' +
          '<span class="pl-k">@import</span> ' +
          '<span class="pl-c1">url</span>(' +
          '<span class="pl-s"><span class="pl-pds">"</span>./foo.css<span class="pl-pds">"</span></span>);' +
          '</code>';

        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, {
            linkMap: { css: { url: '#url' } },
            moduleLinkMap: { css: { './foo.css': { href: '/docs/foo' } } },
          })
          .use(rehypeStringify)
          .process(input);

        const output = String(result);
        // The module specifier should still be linked
        expect(output).toContain('<a href="/docs/foo"');
        // `url` should NOT be linked as a CSS property owner
        expect(output).not.toContain('<a href="#url"');
      });
    });
  });

  describe('export parsing', () => {
    function parseDataExports(html: string): Array<{ name: string; kind: string }> {
      const match = html.match(/data-exports="([^"]*)"/)?.[1];
      if (!match) {
        return [];
      }
      return JSON.parse(match.replace(/&#x22;/g, '"').replace(/&#x27;/g, "'"));
    }

    async function processExport(
      input: string,
      jsLinkMap: Record<string, string> = {},
      opts?: { linkScope?: boolean; linkValues?: boolean },
    ): Promise<string> {
      const result = await unified()
        .use(rehypeParse, { fragment: true })
        .use(enhanceCodeTypes, {
          linkMap: { js: jsLinkMap },
          linkScope: opts?.linkScope,
          linkValues: opts?.linkValues,
        })
        .use(rehypeStringify)
        .process(input);

      return String(result);
    }

    describe('named function exports', () => {
      it('records export function with name and kind', async () => {
        // export function myFunc() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">myFunc</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myFunc', kind: 'function' }]);
      });

      it('adds id to the export keyword span', async () => {
        // export function myFunc() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">myFunc</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(output).toContain('id="myFunc"');
      });
    });

    describe('named const exports', () => {
      it('records export const with name and kind', async () => {
        // export const myConst = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myConst', kind: 'const', type: '42' }]);
      });

      it('adds id to the export keyword span for const', async () => {
        // export const myConst = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(output).toContain('id="myConst"');
      });
    });

    describe('type exports', () => {
      it('records export type with name and kind', async () => {
        // export type MyType = { label: string };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">type</span> <span class="pl-en">MyType</span> <span class="pl-k">=</span> { label: string };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'MyType', kind: 'type' }]);
      });

      it('adds id to the export keyword span for type', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">type</span> <span class="pl-en">MyType</span> <span class="pl-k">=</span> { label: string };' +
          '</code>';

        const output = await processExport(input);
        expect(output).toContain('id="MyType"');
      });
    });

    describe('interface exports', () => {
      it('records export interface with name and kind', async () => {
        // export interface MyInterface { label: string }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">interface</span> <span class="pl-en">MyInterface</span> { label: string }' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'MyInterface', kind: 'interface' }]);
      });
    });

    describe('class exports', () => {
      it('records export class with name and kind', async () => {
        // export class MyClass {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">class</span> <span class="pl-en">MyClass</span> {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'MyClass', kind: 'class' }]);
      });
    });

    describe('enum exports', () => {
      it('records export enum with name and kind', async () => {
        // export enum MyEnum { A, B }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">enum</span> <span class="pl-en">MyEnum</span> { A, B }' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'MyEnum', kind: 'enum' }]);
      });
    });

    describe('let and var exports', () => {
      it('records export let with name and kind', async () => {
        // export let myLet = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">let</span> <span class="pl-c1">myLet</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myLet', kind: 'let', type: '42' }]);
      });

      it('records export var with name and kind', async () => {
        // export var myVar = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">var</span> <span class="pl-c1">myVar</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myVar', kind: 'var', type: '42' }]);
      });
    });

    describe('default exports', () => {
      it('records export default function with name "default"', async () => {
        // export default function myFunc() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">myFunc</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'function' }]);
      });

      it('adds id "default" to the export keyword span for default exports', async () => {
        // export default function myFunc() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">myFunc</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(output).toContain('id="default"');
      });

      it('records export default expression', async () => {
        // export default 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'unknown' }]);
      });

      it('records export default variable reference', async () => {
        // export default myVar;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-smi">myVar</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'unknown' }]);
      });

      it('records export default anonymous function', async () => {
        // export default function() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'function' }]);
      });

      it('records export default anonymous function terminated by semicolon', async () => {
        // export default function() {};
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span>() {};' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'function' }]);
      });

      it('finalizes anonymous default function before the next ASI-terminated declaration', async () => {
        // export default function() {}
        // const x = 1;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span>() {}\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">x</span> = <span class="pl-c1">1</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'function' }]);
        expect(output).toContain('id="default"');
        expect(output).not.toContain('id="x"');
      });

      it('records export default anonymous class terminated by semicolon', async () => {
        // export default class {};
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">class</span> {};' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'class' }]);
      });
    });

    describe('named export list (export { ... })', () => {
      it('records named exports from export { a, b }', async () => {
        // export { alpha, beta };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">alpha</span>, <span class="pl-smi">beta</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'alpha', kind: 'unknown' },
          { name: 'beta', kind: 'unknown' },
        ]);
        // Each identifier span gets its own id
        expect(output).toContain('<span class="pl-smi" id="alpha">');
        expect(output).toContain('<span class="pl-smi" id="beta">');
        // The export keyword span should NOT get an id
        expect(output).not.toContain('<span class="pl-k" id=');
      });

      it('records aliased exports using the external name', async () => {
        // export { foo as bar };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> <span class="pl-k">as</span> <span class="pl-smi">bar</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'bar', kind: 'unknown' }]);
        // The id goes on the alias span (the exported name), not the local name
        expect(output).toContain('<span class="pl-smi" id="bar">');
        expect(output).not.toContain('id="foo"');
      });

      it('records export { foo as default } with name "default"', async () => {
        // export { foo as default };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> <span class="pl-k">as</span> <span class="pl-k">default</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'unknown' }]);
        // The id goes on the 'default' keyword span (the exported name)
        expect(output).toContain('id="default"');
        expect(output).not.toContain('id="foo"');
      });

      it('records export { default } re-export', async () => {
        // export { default } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'default', kind: 'unknown' }]);
        expect(output).toContain('id="default"');
      });

      it('records export { default as Foo } re-export', async () => {
        // export { default as Foo } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span> <span class="pl-k">as</span> <span class="pl-smi">Foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'Foo', kind: 'unknown' }]);
        expect(output).toContain('id="Foo"');
      });

      it('records export { default, named } with both entries', async () => {
        // export { default, foo } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span>, <span class="pl-smi">foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'default', kind: 'unknown' },
          { name: 'foo', kind: 'unknown' },
        ]);
      });
    });

    describe('re-export typeHref enrichment via moduleLinkMap', () => {
      function parseDataExportsFull(
        html: string,
      ): Array<{ name: string; kind: string; typeHref?: string }> {
        const match = html.match(/data-exports="([^"]*)"/)?.[1];
        if (!match) {
          return [];
        }
        return JSON.parse(match.replace(/&#x22;/g, '"').replace(/&#x27;/g, "'"));
      }

      async function processReExport(
        input: string,
        moduleLinkMap: Record<string, ModuleLinkMapEntry>,
      ): Promise<string> {
        const result = await unified()
          .use(rehypeParse, { fragment: true })
          .use(enhanceCodeTypes, {
            linkMap: {},
            moduleLinkMap: { js: moduleLinkMap },
          })
          .use(rehypeStringify)
          .process(input);

        return String(result);
      }

      it('sets typeHref for named re-export from moduleLinkMap', async () => {
        // export { foo } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            exports: { foo: { slug: '#foo' } },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'foo', kind: 'unknown', typeHref: '/docs/mod#foo' },
        ]);
      });

      it('sets typeHref for default re-export using defaultSlug', async () => {
        // export { default } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            defaultSlug: '#default-export',
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'default', kind: 'unknown', typeHref: '/docs/mod#default-export' },
        ]);
      });

      it('sets typeHref for aliased default re-export', async () => {
        // export { default as Foo } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span> <span class="pl-k">as</span> <span class="pl-smi">Foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            defaultSlug: '#default-export',
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'Foo', kind: 'unknown', typeHref: '/docs/mod#default-export' },
        ]);
      });

      it('enriches multiple re-exports from the same module', async () => {
        // export { foo, bar } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span>, <span class="pl-smi">bar</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            exports: {
              foo: { slug: '#foo' },
              bar: { slug: '#bar' },
            },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'foo', kind: 'unknown', typeHref: '/docs/mod#foo' },
          { name: 'bar', kind: 'unknown', typeHref: '/docs/mod#bar' },
        ]);
      });

      it('does not set typeHref when module is not in moduleLinkMap', async () => {
        // export { foo } from './unknown';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./unknown<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            exports: { foo: { slug: '#foo' } },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([{ name: 'foo', kind: 'unknown' }]);
      });

      it('does not set typeHref when export name is not in module exports', async () => {
        // export { baz } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">baz</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            exports: { foo: { slug: '#foo' } },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([{ name: 'baz', kind: 'unknown' }]);
      });

      it('sets kind from moduleLinkMap exports entry', async () => {
        // export { Button } from './components';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">Button</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./components<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './components': {
            href: '/docs/components',
            exports: { Button: { slug: '#button', kind: 'function' } },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'Button', kind: 'function', typeHref: '/docs/components#button' },
        ]);
      });

      it('sets defaultKind for default re-export', async () => {
        // export { default } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-k">default</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            defaultSlug: '#default',
            defaultKind: 'class',
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'default', kind: 'class', typeHref: '/docs/mod#default' },
        ]);
      });

      it('keeps kind as unknown when no kind is provided', async () => {
        // export { foo } from './mod';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> } <span class="pl-k">from</span> <span class="pl-s"><span class="pl-pds">\'</span>./mod<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processReExport(input, {
          './mod': {
            href: '/docs/mod',
            exports: { foo: { slug: '#foo' } },
          },
        });
        expect(parseDataExportsFull(output)).toEqual([
          { name: 'foo', kind: 'unknown', typeHref: '/docs/mod#foo' },
        ]);
      });
    });

    describe('multiple exports in one code block', () => {
      it('collects multiple exports', async () => {
        // export function foo() {}\nexport const bar = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">foo</span>() {}\n' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">bar</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'foo', kind: 'function' },
          { name: 'bar', kind: 'const', type: '42' },
        ]);
      });

      it('each export keyword gets its own id', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">foo</span>() {}\n' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">bar</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(output).toContain('id="foo"');
        expect(output).toContain('id="bar"');
      });
    });

    describe('multi-declarator variable exports', () => {
      it('captures all declarators in export const a = 1, b = 2', async () => {
        // export const a = 1, b = 2;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> = <span class="pl-c1">1</span>, <span class="pl-c1">b</span> = <span class="pl-c1">2</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'a', kind: 'const', type: '1' },
          { name: 'b', kind: 'const', type: '2' },
        ]);
      });

      it('captures three declarators', async () => {
        // export let x = 'a', y = 'b', z = 'c';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">let</span> <span class="pl-c1">x</span> = ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>a<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-c1">y</span> = ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>b<span class="pl-pds">\'</span></span>, ' +
          '<span class="pl-c1">z</span> = ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>c<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'x', kind: 'let', type: "'a'" },
          { name: 'y', kind: 'let', type: "'b'" },
          { name: 'z', kind: 'let', type: "'c'" },
        ]);
      });

      it('skips commas inside function call arguments', async () => {
        // export const a = foo(1, 2), b = 3;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> = ' +
          '<span class="pl-en">foo</span>(<span class="pl-c1">1</span>, <span class="pl-c1">2</span>), ' +
          '<span class="pl-c1">b</span> = <span class="pl-c1">3</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'a', kind: 'const' },
          { name: 'b', kind: 'const', type: '3' },
        ]);
      });

      it('skips commas inside array literals', async () => {
        // export const a = [1, 2], b = 3;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> = [<span class="pl-c1">1</span>, <span class="pl-c1">2</span>], ' +
          '<span class="pl-c1">b</span> = <span class="pl-c1">3</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'a', kind: 'const' },
          { name: 'b', kind: 'const', type: '3' },
        ]);
      });
    });

    describe('no data-exports when there are no exports', () => {
      it('does not add data-exports for non-export code', async () => {
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">foo</span> = <span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(output).not.toContain('data-exports');
      });
    });

    describe('non-JS languages', () => {
      it('does not parse exports in CSS', async () => {
        const input =
          '<code class="language-css"><span class="pl-k">export</span> .class {}</code>';

        const output = await processExport(input);
        expect(output).not.toContain('data-exports');
      });
    });

    describe('re-exports', () => {
      it('records re-exported names from export { a } from "mod"', async () => {
        // export { alpha } from '@foo';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">alpha</span> } ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>@foo<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'alpha', kind: 'unknown' }]);
      });

      it('records star re-export from export * from "mod"', async () => {
        // export * from './module';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> * ' +
          '<span class="pl-k">from</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>./module<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: '*', kind: 'unknown' }]);
        // The export keyword should have id="*"
        expect(output).toContain('id="*"');
      });
    });

    describe('export type inference', () => {
      it('captures type annotation on export const', async () => {
        // export const myConst: MyType = value;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">MyType</span> <span class="pl-k">=</span> value;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'myConst', kind: 'const', type: 'MyType' },
        ]);
      });

      it('captures string literal value as type when no annotation', async () => {
        // export const myConst = 'hello';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'myConst', kind: 'const', type: "'hello'" },
        ]);
      });

      it('captures number literal value as type when no annotation', async () => {
        // export const myConst = 100;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = ' +
          '<span class="pl-c1">100</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myConst', kind: 'const', type: '100' }]);
      });

      it('captures boolean literal value as type when no annotation', async () => {
        // export const myConst = true;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = ' +
          '<span class="pl-c1">true</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'myConst', kind: 'const', type: 'true' },
        ]);
      });

      it('prefers type annotation over literal value', async () => {
        // export const myConst: string = 'hello';
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">string</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'myConst', kind: 'const', type: 'string' },
        ]);
      });

      it('does not add type for function exports', async () => {
        // export function myFunc() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">myFunc</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myFunc', kind: 'function' }]);
      });

      it('does not add type for named export lists', async () => {
        // export { foo, bar };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span>, <span class="pl-smi">bar</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'foo', kind: 'unknown' },
          { name: 'bar', kind: 'unknown' },
        ]);
      });

      it('links export list identifiers via scope resolution when linkScope is enabled', async () => {
        // { const test: Test = {}; export { test } }
        const input =
          '<code class="language-tsx">{' +
          '<span class="pl-k">const</span> <span class="pl-c1">test</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> {}; ' +
          '<span class="pl-k">export</span> { <span class="pl-smi">test</span> };' +
          '}</code>';

        const output = await processExport(input, { Test: '#test-type' }, { linkScope: true });
        // The 'test' identifier inside export { } should be linked via scope resolution
        expect(output).toContain('<a href="#test-type"');
        expect(output).toContain('>test</a>');
        // The id must be on the rendered link element, not the pre-transform span
        expect(output).toContain('id="test"');
        expect(output).toMatch(/<a [^>]*id="test"/);
        // Export metadata should be enriched with type info from scope
        expect(parseDataExports(output)).toEqual([
          { name: 'test', kind: 'const', type: 'Test', typeHref: '#test-type' },
        ]);
      });

      it('annotates export list identifiers with value bindings when linkValues is enabled', async () => {
        // const label = 'hello'; export { label }
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">const</span> <span class="pl-c1">label</span> <span class="pl-k">=</span> ' +
          '<span class="pl-s"><span class="pl-pds">\'</span>hello<span class="pl-pds">\'</span></span>; ' +
          '<span class="pl-k">export</span> { <span class="pl-smi">label</span> };' +
          '</code>';

        const output = await processExport(input, {}, { linkScope: true, linkValues: true });
        // The 'label' identifier inside export { } should have data-value annotation
        expect(output).toContain('data-value="&#x27;hello&#x27;"');
        // Export metadata should be enriched from value scope
        expect(parseDataExports(output)).toEqual([
          { name: 'label', kind: 'const', type: "'hello'" },
        ]);
      });

      it('enriches aliased export with type info from scope using localName', async () => {
        // { const foo: Foo = {}; export { foo as bar } }
        const input =
          '<code class="language-tsx">{' +
          '<span class="pl-k">const</span> <span class="pl-c1">foo</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">Foo</span> <span class="pl-k">=</span> {}; ' +
          '<span class="pl-k">export</span> { <span class="pl-smi">foo</span> <span class="pl-k">as</span> <span class="pl-smi">bar</span> };' +
          '}</code>';

        const output = await processExport(input, { Foo: '#foo-type' }, { linkScope: true });
        // Export is recorded under the aliased name 'bar' but type comes from local 'foo'
        expect(parseDataExports(output)).toEqual([
          { name: 'bar', kind: 'const', type: 'Foo', typeHref: '#foo-type' },
        ]);
      });

      it('does not leak type across statement boundaries', async () => {
        // export const a = 42;\nexport function b() {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> = <span class="pl-c1">42</span>;\n' +
          '<span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">b</span>() {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'a', kind: 'const', type: '42' },
          { name: 'b', kind: 'function' },
        ]);
      });

      it('captures type annotation on export let', async () => {
        // export let counter: number = 0;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">let</span> <span class="pl-c1">counter</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">number</span> <span class="pl-k">=</span> <span class="pl-c1">0</span>;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'counter', kind: 'let', type: 'number' },
        ]);
      });

      it('omits type when value is not a simple literal', async () => {
        // export const myConst = someFunction();
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = ' +
          '<span class="pl-en">someFunction</span>();' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'myConst', kind: 'const' }]);
      });

      it('records arrow function export as kind function', async () => {
        // export const test = () => {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">test</span> <span class="pl-k">=</span> () <span class="pl-k">=&gt;</span> {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'test', kind: 'function' }]);
      });

      it('captures type annotation on arrow function export', async () => {
        // export const test: Test = () => {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">test</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> () <span class="pl-k">=&gt;</span> {}' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'test', kind: 'function', type: 'Test' },
        ]);
      });

      it('records arrow function export without parens as kind function', async () => {
        // export const test = param => param.trim()
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">test</span> <span class="pl-k">=</span> ' +
          '<span class="pl-smi">param</span> <span class="pl-k">=&gt;</span> <span class="pl-smi">param</span>.<span class="pl-en">trim</span>()' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'test', kind: 'function' }]);
      });

      it('includes typeHref when type annotation is in linkMap', async () => {
        // export const test: Test = () => {}
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">test</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">Test</span> <span class="pl-k">=</span> () <span class="pl-k">=&gt;</span> {}' +
          '</code>';

        const output = await processExport(input, { Test: '#test-type' });
        expect(parseDataExports(output)).toEqual([
          { name: 'test', kind: 'function', type: 'Test', typeHref: '#test-type' },
        ]);
      });

      it('omits typeHref when type annotation is not in linkMap', async () => {
        // export const myConst: MyType = value;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">MyType</span> <span class="pl-k">=</span> value;' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'myConst', kind: 'const', type: 'MyType' },
        ]);
      });

      it('does not add typeHref for literal types', async () => {
        // export const myConst = 42;
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">myConst</span> = ' +
          '<span class="pl-c1">42</span>;' +
          '</code>';

        const output = await processExport(input, { '42': '#forty-two' });
        expect(parseDataExports(output)).toEqual([{ name: 'myConst', kind: 'const', type: '42' }]);
      });

      it('does not leak type across ASI boundaries', async () => {
        // export const a = build()
        // const b: Type = 1
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-en">build</span>()\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">b</span>' +
          '<span class="pl-k">:</span> <span class="pl-en">Type</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;' +
          '</code>';

        const output = await processExport(input, { Type: '#type' });
        expect(parseDataExports(output)).toEqual([{ name: 'a', kind: 'const' }]);
      });

      it('does not reclassify export const to function from a later arrow across ASI boundary', async () => {
        // export const a = 42
        // someCallback(() => {})
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">42</span>\n' +
          '<span class="pl-en">someCallback</span>(() <span class="pl-k">=></span> {})' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'a', kind: 'const', type: '42' }]);
      });

      it('does not reclassify export const to function when initializer is a function call', async () => {
        // export const a = build()
        // someCallback(() => {})
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> ' +
          '<span class="pl-en">build</span>()\n' +
          '<span class="pl-en">someCallback</span>(() <span class="pl-k">=></span> {})' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'a', kind: 'const' }]);
      });
    });

    describe('export type list (export type { ... })', () => {
      it('records export type { Foo, Bar } as kind type', async () => {
        // export type { Foo, Bar };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">type</span> { <span class="pl-smi">Foo</span>, <span class="pl-smi">Bar</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([
          { name: 'Foo', kind: 'type' },
          { name: 'Bar', kind: 'type' },
        ]);
      });

      it('records export type { Foo as Renamed } with aliased name', async () => {
        // export type { Foo as Renamed };
        const input =
          '<code class="language-tsx">' +
          '<span class="pl-k">export</span> <span class="pl-k">type</span> { <span class="pl-smi">Foo</span> <span class="pl-k">as</span> <span class="pl-smi">Renamed</span> };' +
          '</code>';

        const output = await processExport(input);
        expect(parseDataExports(output)).toEqual([{ name: 'Renamed', kind: 'type' }]);
      });
    });
  });
});

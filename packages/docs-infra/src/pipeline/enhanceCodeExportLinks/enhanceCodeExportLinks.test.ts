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

  describe('typeRefComponent option', () => {
    async function processHtmlWithTypeRef(
      input: string,
      anchorMap: Record<string, string>,
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
      const input = '<code><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, anchorMap, 'TypeRef');

      expect(output).toBe(
        '<code><TypeRef href="#trigger" name="Trigger" class="pl-c1">Trigger</TypeRef></code>',
      );
    });

    it('emits a custom component element for a dotted chain', async () => {
      const input =
        '<code><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></code>';
      const anchorMap = { 'Accordion.Trigger': '#trigger' };

      const output = await processHtmlWithTypeRef(input, anchorMap, 'TypeRef');

      expect(output).toBe(
        '<code><TypeRef href="#trigger" name="Accordion.Trigger"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></TypeRef></code>',
      );
    });

    it('still falls back to no linking when identifier is not in anchorMap', async () => {
      const input = '<code><span class="pl-c1">Unknown</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtmlWithTypeRef(input, anchorMap, 'TypeRef');

      expect(output).toBe('<code><span class="pl-c1">Unknown</span></code>');
    });

    it('uses standard anchor when typeRefComponent is not set', async () => {
      const input = '<code><span class="pl-c1">Trigger</span></code>';
      const anchorMap = { Trigger: '#trigger' };

      const output = await processHtml(input, anchorMap);

      expect(output).toBe('<code><a href="#trigger" class="pl-c1">Trigger</a></code>');
    });

    it('emits custom elements in nested structures', async () => {
      const input =
        '<code><span class="frame"><span class="line"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></span></span></code>';
      const anchorMap = { 'Component.Root': '#root' };

      const output = await processHtmlWithTypeRef(input, anchorMap, 'TypeRef');

      expect(output).toBe(
        '<code><span class="frame"><span class="line"><TypeRef href="#root" name="Component.Root"><span class="pl-en">Component</span>.<span class="pl-en">Root</span></TypeRef></span></span></code>',
      );
    });
  });

  describe('linkProps option', () => {
    /**
     * Helper to process HTML with linkProps enabled.
     */
    async function processWithLinkProps(
      input: string,
      anchorMap: Record<string, string>,
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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('wraps multiple pl-v properties', async () => {
        // type Item = { label: string; count: number; };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
        expect(output).toContain(
          '<span id="item:count" data-name="Item" data-prop="count" class="pl-v">count</span>',
        );
      });

      it('also links the type name as a type ref', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span>?<span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span>?<span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">?:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('does not wrap properties when owner is not in anchorMap', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
      });

      it('wraps multiple plain text properties', async () => {
        // const item: Item = { label: "hello", count: 5 };
        const input =
          '<code><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span>, count: <span class="pl-c1">5</span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#item:label" data-name="Item" data-prop="label">label</a>',
        );
        expect(output).toContain(
          '<a href="#item:count" data-name="Item" data-prop="count">count</a>',
        );
      });

      it('does not wrap property when type annotation is not in anchorMap', async () => {
        const input =
          '<code><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Unknown</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).not.toContain('<a href=');
      });

      it('links properties when type annotation is a dotted chain', async () => {
        // const props: Accordion.Root.Props = { label: 'test' };
        const input =
          '<code><span class="pl-k">const</span> <span class="pl-c1">props</span><span class="pl-k">:</span> <span class="pl-en">Accordion</span>.<span class="pl-en">Root</span>.<span class="pl-en">Props</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>test<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { 'Accordion.Root.Props': '#root.props' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#root.props:label" data-name="Accordion.Root.Props" data-prop="label">label</a>',
        );
      });
    });

    describe('function call properties (plain text)', () => {
      it('wraps properties in function call object arguments', async () => {
        // Matches starry-night output for: makeItem({ label: "hello" });
        const input =
          '<code><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('also links the function name as a type ref', async () => {
        const input =
          '<code><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-en">makeItem</span>(<span class="pl-c1">someArg</span>, { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:1:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('links properties of multiple object parameters with correct indices', async () => {
        // makeItem({ name: "a" }, { label: "b" })
        const input =
          '<code><span class="pl-en">makeItem</span>({ name: <span class="pl-s"><span class="pl-pds">"</span>a<span class="pl-pds">"</span></span> }, { label: <span class="pl-s"><span class="pl-pds">"</span>b<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-en">unknownFn</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).not.toContain('<a href=');
        expect(output).not.toContain('<span id=');
        expect(output).toContain('label');
      });
    });

    describe('named parameter anchors (anchorMap[name[N]])', () => {
      it('uses named param anchor as base href when available', async () => {
        // makeItem({ label: "hello" }) with makeItem[0] providing a named base
        const input =
          '<code><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:props:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('falls back to index-based href when named param anchor is missing', async () => {
        // makeItem({ label: "hello" }) without makeItem[0] in anchorMap
        const input =
          '<code><span class="pl-en">makeItem</span>({ label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#make-item::label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for non-zero parameter indices', async () => {
        // makeItem(someArg, { label: "hello" }) with makeItem[1] providing a named base
        const input =
          '<code><span class="pl-en">makeItem</span>(<span class="pl-c1">someArg</span>, { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[1]': '#make-item:options' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#make-item:options:label" data-name="makeItem" data-prop="label">label</a>',
        );
      });

      it('uses named param anchor for JSX component props', async () => {
        const input =
          '<code>&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card', 'Card[0]': '#card:props' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#card:props:label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('falls back to index-based href for JSX when named anchor is missing', async () => {
        const input =
          '<code>&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('uses named param anchor with deep nested property paths', async () => {
        // type equivalent with function call: makeItem({ details: { label: "hello" } })
        const input =
          '<code><span class="pl-en">makeItem</span>({ details: { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> } });</code>';
        const anchorMap = { makeItem: '#make-item', 'makeItem[0]': '#make-item:props' };

        const output = await processWithLinkProps(input, anchorMap, 'deep');

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
          '<code>&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
      });

      it('wraps multiple JSX attributes', async () => {
        // <Card label="hello" count={5} />
        const input =
          '<code>&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> <span class="pl-e">count</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-c1">5</span><span class="pl-pse">}</span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<a href="#card::label" data-name="Card" data-prop="label" class="pl-e">label</a>',
        );
        expect(output).toContain(
          '<a href="#card::count" data-name="Card" data-prop="count" class="pl-e">count</a>',
        );
      });

      it('does not wrap attributes when component is not in anchorMap', async () => {
        const input =
          '<code>&#x3C;<span class="pl-c1">Unknown</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain('<span class="pl-e">label</span>');
      });
    });

    describe('nested objects (linkProps: deep)', () => {
      it('links nested property with dotted path', async () => {
        // type Item = { details: { label: string; }; };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'deep');

        expect(output).toContain(
          '<span id="item:details" data-name="Item" data-prop="details" class="pl-v">details</span>',
        );
        expect(output).toContain(
          '<span id="item:details.label" data-name="Item" data-prop="details.label" class="pl-v">label</span>',
        );
      });

      it('does not link nested properties in shallow mode', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">a</span><span class="pl-k">:</span> { <span class="pl-v">b</span><span class="pl-k">:</span> { <span class="pl-v">c</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'deep');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">details</span><span class="pl-k">:</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'deep');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">firstName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain(
          '<span id="item:first-name" data-name="Item" data-prop="first-name" class="pl-v">firstName</span>',
        );
      });

      it('converts each segment of nested path independently', async () => {
        // type Item = { homeAddress: { streetName: string; }; };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">homeAddress</span><span class="pl-k">:</span> { <span class="pl-v">streetName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'deep');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef id="item:label" name="Item" prop="label" class="pl-v">label</TypePropRef>',
        );
      });

      it('emits custom element for plain text props', async () => {
        const input =
          '<code><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { label: <span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#item:label" name="Item" prop="label">label</TypePropRef>',
        );
      });

      it('emits custom element for JSX pl-e props', async () => {
        const input =
          '<code>&#x3C;<span class="pl-c1">Card</span> <span class="pl-e">label</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span> /></code>';
        const anchorMap = { Card: '#card' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain(
          '<TypePropRef href="#card::label" name="Card" prop="label" class="pl-e">label</TypePropRef>',
        );
      });

      it('applies kebab-case to prop attribute', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">firstName</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
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
          '<code><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processHtml(input, anchorMap);

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
          '<code><span class="frame">' +
          '<span class="line"><span class="pl-k">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> {</span>' +
          '<span class="line">  <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>;</span>' +
          '<span class="line">};</span>' +
          '</span></code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain('<a href="#item" class="pl-en">Item</a>');
        expect(output).toContain(
          '<span id="item:label" data-name="Item" data-prop="label" class="pl-v">label</span>',
        );
      });

      it('links multiple properties when "type" has pl-en class', async () => {
        const input =
          '<code><span class="pl-en">type</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">name</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">count</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">const</span> <span class="pl-c1">item</span><span class="pl-k">:</span> <span class="pl-en">Item</span> <span class="pl-k">=</span> { <span class="pl-v">label</span><span class="pl-k">:</span> <span class="pl-c1">5</span> };</code>';
        const anchorMap = { Item: '#item' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

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
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        // All properties should be linked — no bare pl-v spans remaining
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">cancel</span>');
        expect(output).toContain('id="details:cancel"');
      });

      it('links duplicate property names in every union branch', async () => {
        // Two branches with the same property names
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-en">MouseEvent</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-en">Event</span>; }' +
          ');</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        // No unlinked pl-v property spans should remain
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">event</span>');
      });

      it('links properties in both union branches', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">event</span><span class="pl-k">:</span> <span class="pl-c1">Event</span>; }' +
          ');</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain('id="details:reason"');
        expect(output).toContain('id="details:event"');
      });

      it('links properties in intersection part after union', async () => {
        // type Details = ( | { a: string } ) & { b: number };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure union without intersection', async () => {
        // type Details = | { a: string } | { b: number };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> ' +
          '<span class="pl-k">|</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          '<span class="pl-k">|</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).not.toContain('<span class="pl-v">a</span>');
        expect(output).not.toContain('<span class="pl-v">b</span>');
        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties in pure intersection without union', async () => {
        // type Details = { a: string } & { b: number };
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> { <span class="pl-v">a</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; } <span class="pl-k">&amp;</span> { <span class="pl-v">b</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).not.toContain('<span class="pl-v">a</span>');
        expect(output).not.toContain('<span class="pl-v">b</span>');
        expect(output).toContain('id="details:a"');
        expect(output).toContain('id="details:b"');
      });

      it('links properties across line boundaries in multi-line union', async () => {
        const input =
          '<code><span class="frame">' +
          '<span class="line"><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (</span>' +
          '<span class="line">  <span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }</span>' +
          '<span class="line">  <span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }</span>' +
          '<span class="line">) <span class="pl-k">&amp;</span> {</span>' +
          '<span class="line">  <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>;</span>' +
          '<span class="line">};</span>' +
          '</span></code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        // No bare pl-v property spans should remain
        expect(output).not.toContain('<span class="pl-v">reason</span>');
        expect(output).not.toContain('<span class="pl-v">cancel</span>');
        expect(output).toContain('id="details:cancel"');
      });

      it('does not leak typeDefPersist to unrelated code after type without semicolon', async () => {
        // type A = { x: string } then an unrelated object literal on a new statement
        // Without proper cleanup, the second { } would get linked as A's properties
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">A</span> <span class="pl-k">=</span> { <span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }\n' +
          '<span class="pl-k">type</span> <span class="pl-en">B</span> <span class="pl-k">=</span> { <span class="pl-v">y</span><span class="pl-k">:</span> <span class="pl-c1">number</span>; }</code>';
        const anchorMap = { A: '#a', B: '#b' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        // x should belong to A, y should belong to B
        expect(output).toContain('id="a:x"');
        expect(output).toContain('id="b:y"');
        // y should NOT be linked as A's property
        expect(output).not.toContain('id="a:y"');
      });

      it('does not leak typeDefPersist when type alias has no trailing semicolon', async () => {
        // type A = { x: string } (no semicolon) — B should not inherit A's context
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">A</span> <span class="pl-k">=</span> { <span class="pl-v">x</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }\n' +
          '<span class="pl-k">const</span> <span class="pl-c1">obj</span> <span class="pl-k">=</span> { unrelated<span class="pl-k">:</span> <span class="pl-c1">true</span> }</code>';
        const anchorMap = { A: '#a' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow');

        expect(output).toContain('id="a:x"');
        // "unrelated" should NOT be linked as A's property
        expect(output).not.toContain('id="a:unrelated"');
      });

      it('uses typePropRefComponent for union properties', async () => {
        const input =
          '<code><span class="pl-k">type</span> <span class="pl-en">Details</span> <span class="pl-k">=</span> (' +
          '<span class="pl-k">|</span> { <span class="pl-v">reason</span><span class="pl-k">:</span> <span class="pl-c1">string</span>; }' +
          ') <span class="pl-k">&amp;</span> { <span class="pl-v">cancel</span><span class="pl-k">:</span> <span class="pl-c1">void</span>; };</code>';
        const anchorMap = { Details: '#details' };

        const output = await processWithLinkProps(input, anchorMap, 'shallow', {
          typePropRefComponent: 'TypePropRef',
        });

        expect(output).toContain('<TypePropRef id="details:reason"');
        expect(output).toContain('<TypePropRef id="details:cancel"');
      });
    });
  });
});

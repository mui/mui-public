import { describe, it, expect, beforeAll } from 'vitest';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { createParseSource } from '../parseSource';
import {
  enhanceCodeEmphasis,
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from './enhanceCodeEmphasis';
import { parseImportsAndComments } from '../loaderUtils/parseImportsAndComments';
import type { HastRoot, ParseSource, SourceEnhancer } from '../../CodeHighlighter/types';

/**
 * Test helper to parse code, enhance it, and return HTML via rehype-stringify.
 */
async function testEmphasis(
  code: string,
  parseSource: ParseSource,
  fileName = 'test.tsx',
  enhancer: SourceEnhancer = enhanceCodeEmphasis,
): Promise<string> {
  // Extract comments from the code using parseImportsAndComments
  // This also returns code with comments removed
  const { comments: parsedComments, code: codeWithoutComments } = await parseImportsAndComments(
    code,
    `file:///${fileName}`,
    {
      notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX],
      removeCommentsWithPrefix: [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX],
    },
  );

  // parseImportsAndComments uses 0-based line numbers, but we need 1-based
  // Convert the line numbers by adding 1 to each key
  const comments: Record<number, string[]> = {};
  if (parsedComments) {
    for (const [lineStr, commentArray] of Object.entries(parsedComments)) {
      const zeroBasedLine = parseInt(lineStr, 10);
      const oneBasedLine = zeroBasedLine + 1;
      comments[oneBasedLine] = commentArray;
    }
  }

  // Parse the code with comments removed, then enhance
  const root = await parseSource(codeWithoutComments ?? code, fileName);
  const enhanced = enhancer(root, comments, fileName) as HastRoot;

  // Convert to HTML using rehype-stringify
  const html = unified().use(rehypeStringify).stringify(enhanced);

  return html;
}

describe('enhanceCodeEmphasis', () => {
  let parseSource: ParseSource;

  beforeAll(async () => {
    parseSource = await createParseSource();
  });

  describe('EMPHASIS_COMMENT_PREFIX', () => {
    it('should export the correct prefix', () => {
      expect(EMPHASIS_COMMENT_PREFIX).toBe('@highlight');
    });
  });

  describe('single line emphasis', () => {
    it('should emphasize a single line with @highlight', async () => {
      const result = await testEmphasis(
        `export default function Button() {
  return (
    <button className="primary">Click me</button> // @highlight
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Button</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="3" data-frame-type="highlighted" data-frame-indent="2"><span class="line" data-ln="3">    &#x3C;<span class="pl-ent">button</span> <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>primary<span class="pl-pds">"</span></span>>Click me&#x3C;/<span class="pl-ent">button</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="5"><span class="line" data-ln="4">  );</span>
        <span class="line" data-ln="5">}</span></span>"
      `);
    });

    it('should emphasize multiple single lines', async () => {
      const result = await testEmphasis(
        `const a = 1; // @highlight
const b = 2;
const c = 3; // @highlight
const d = 4;
const e = 5; // @highlight`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2"><span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="3" data-frame-type="highlighted-unfocused" data-frame-indent="0"><span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="4"><span class="line" data-ln="4"><span class="pl-k">const</span> <span class="pl-c1">d</span> <span class="pl-k">=</span> <span class="pl-c1">4</span>;</span>
        </span>"
      `,
      );
    });

    it('should handle @highlight with description', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  const [count, setCount] = useState(0); // @highlight "We track state"
  return <div>{count}</div>;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1" data-frame-description="We track state"><span class="line" data-ln="2">  <span class="pl-k">const</span> [<span class="pl-c1">count</span>, <span class="pl-c1">setCount</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>(<span class="pl-c1">0</span>);</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="4"><span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">div</span>><span class="pl-pse">{</span><span class="pl-smi">count</span><span class="pl-pse">}</span>&#x3C;/<span class="pl-ent">div</span>>;</span>
        <span class="line" data-ln="4">}</span></span>"
      `);
    });

    it('should use data-hl="strong" when description ends with !', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  const url = getUrl(); // @highlight "We must provide the URL!"
  return <a href={url}>Link</a>;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="strong" data-hl-description="We must provide the URL" data-hl-position="single">  <span class="pl-k">const</span> <span class="pl-c1">url</span> <span class="pl-k">=</span> <span class="pl-en">getUrl</span>();</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="4"><span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">a</span> <span class="pl-e">href</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">url</span><span class="pl-pse">}</span>>Link&#x3C;/<span class="pl-ent">a</span>>;</span>
        <span class="line" data-ln="4">}</span></span>"
      `);
    });
  });

  describe('multiline emphasis', () => {
    it('should emphasize lines between @highlight-start and @highlight-end', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    // @highlight-start
    <div>
      <h1>Heading 1</h1>
      <p>Some content</p>
    </div>
    // @highlight-end
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="6" data-frame-type="highlighted" data-frame-indent="2"><span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5">      &#x3C;<span class="pl-ent">p</span>>Some content&#x3C;/<span class="pl-ent">p</span>></span>
        <span class="line" data-ln="6">    &#x3C;/<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="7" data-frame-end-line="8"><span class="line" data-ln="7">  );</span>
        <span class="line" data-ln="8">}</span></span>"
      `);
    });

    it('should handle adjacent start and end (no lines between)', async () => {
      const result = await testEmphasis(
        `function test() {
  // @highlight-start
  // @highlight-end
  return null;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> <span class="pl-c1">null</span>;</span>
        <span class="line" data-ln="3">}</span></span>"
      `);
    });

    it('should handle single line content between stripped comments', async () => {
      // When comments are stripped, a single line between them should be emphasized
      const result = await testEmphasis(
        `function test() {
  // @highlight-start
  return null;
  // @highlight-end
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2">  <span class="pl-k">return</span> <span class="pl-c1">null</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="3"><span class="line" data-ln="3">}</span></span>"
      `,
      );
    });

    it('should handle @highlight-start with description', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    // @highlight-start "We add a heading with an h1"
    <div>
      <h1>Heading 1</h1>
    </div>
    // @highlight-end
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="5" data-frame-type="highlighted" data-frame-indent="2" data-frame-description="We add a heading with an h1"><span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5">    &#x3C;/<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="6" data-frame-end-line="7"><span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });

    it('should handle nested multiline emphasis', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  // @highlight-start
  return (
    // @highlight-start
    <div>
      <h1>Heading 1</h1>
    </div>
    // @highlight-end
  );
  // @highlight-end
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="6" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="strong" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="strong">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="strong" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        </span><span class="frame" data-lined="" data-frame-start-line="7" data-frame-end-line="7"><span class="line" data-ln="7">}</span></span>"
      `);
    });
  });

  describe('text highlight', () => {
    it('should highlight specific text within a line using @highlight-text', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    <div>
      <h1>Heading 1</h1> {/* @highlight-text "Heading 1" */}
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span>><span data-hl="">Heading 1</span>&#x3C;/<span class="pl-ent">h1</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="5" data-frame-end-line="7"><span class="line" data-ln="5">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });

    it('should highlight multiple texts within a line using @highlight-text', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    <div>
      <h1 className="primary">Heading 1</h1> {/* @highlight-text "primary" "Heading 1" */}
    </div>
  );
}`,
        parseSource,
      );

      // Both "primary" and "Heading 1" should be wrapped in data-hl spans
      // Comments are stripped, so only code matches appear
      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span> <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span><span data-hl="">primary</span><span class="pl-pds">"</span></span>><span data-hl="">Heading 1</span>&#x3C;/<span class="pl-ent">h1</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="5" data-frame-end-line="7"><span class="line" data-ln="5">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });

    it('should not produce nested highlight spans when tokens overlap', async () => {
      const result = await testEmphasis(
        `const heading = "Heading 1"; // @highlight-text "Heading" "Heading 1"`,
        parseSource,
        'test.ts',
      );

      // "Heading" is a substring of "Heading 1"
      // The first token "Heading" gets wrapped; the second "Heading 1" should not
      // nest inside the already-highlighted span. Only the first match wins.
      // Verify no nested data-hl spans exist
      expect(result).not.toContain('data-hl=""><span data-hl="">');
    });

    it('should highlight JSX prop expressions', async () => {
      const result = await testEmphasis(
        `<AlertDialog.Trigger handle={demoAlertDialog}>Open</AlertDialog.Trigger> {/* @highlight-text "handle={demoAlertDialog}" */}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `"<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1">&#x3C;<span class="pl-c1">AlertDialog.Trigger</span> <span data-hl=""><span class="pl-e">handle</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">demoAlertDialog</span><span class="pl-pse">}</span></span>>Open&#x3C;/<span class="pl-c1">AlertDialog.Trigger</span>></span></span>"`,
      );
    });

    it('should highlight text on the next line when comment is on its own line', async () => {
      const result = await testEmphasis(
        `// @highlight-text "nativeButton={false}"
<Button render={<div />} nativeButton={false}>`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `"<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1">&#x3C;<span class="pl-c1">Button</span> <span class="pl-e">render</span><span class="pl-k">=</span><span class="pl-pse">{</span>&#x3C;<span class="pl-ent">div</span> /><span class="pl-pse">}</span> <span data-hl=""><span class="pl-e">nativeButton</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-c1">false</span><span class="pl-pse">}</span></span>></span></span>"`,
      );
    });

    it('should highlight text in CSS', async () => {
      const result = await testEmphasis(
        `  height: min(40px, var(--scroll-area-overflow-y-end, 40px)); /* @highlight-text ", 40px" */`,
        parseSource,
        'test.css',
      );

      expect(result).toContain('<span data-hl="">, 40px</span>');
    });

    it('should handle @highlight and @highlight-text on adjacent CSS lines', async () => {
      const result = await testEmphasis(
        `.Viewport::after {
   /* @highlight */
  height: min(40px, var(--scroll-area-overflow-y-end, 40px)); /* @highlight-text ", 40px" */
}`,
        parseSource,
        'test.css',
      );

      // Both comments map to the same output line after the @highlight comment line is removed.
      // The line should NOT have data-hl (simple highlight, frame handles it)
      // but should still wrap ", 40px" from @highlight-text.
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl=""/);
      expect(result).toMatch(/data-frame-type="highlighted"/);
      // The text highlight wraps ", 40px" which contains syntax-highlighted children
      expect(result).toContain(
        '<span data-hl="">, <span class="pl-c1">40</span><span class="pl-k">px</span></span>',
      );
    });

    it('should split element nodes precisely at match boundaries', async () => {
      const result = await testEmphasis(
        `<MyComponent nativeButton={false} disabled> // @highlight-text "={false}"`,
        parseSource,
      );

      // "={false}" spans a pl-k (=), a pl-pse ({), a pl-c1 (false), and a pl-pse (}).
      // The highlight should NOT include the preceding "nativeButton" text from the pl-e element.
      expect(result).not.toContain('<span data-hl="">nativeButton');
      expect(result).toContain('data-hl="">');
    });

    it('should use data-hl-part when match straddles an element boundary', async () => {
      const result = await testEmphasis(
        `<MyComponent nativeButton={false}> // @highlight-text "Button={false}"`,
        parseSource,
      );

      // "Button={false}" starts inside the pl-e element ("nativeButton")
      // and continues through the pl-k, pl-pse, pl-c1, and pl-pse elements.
      // The pl-e is never split — highlight is injected inside it.
      // The remaining elements are wrapped in a single data-hl span.
      expect(result).toContain('data-hl-part="start"');
      expect(result).toContain('data-hl-part="end"');
      // The pl-e element must remain intact
      expect(result).toContain('<span class="pl-e">');
      expect(result).not.toContain('<span class="pl-e">native</span>');
    });

    it('should use data-hl-part for nested fragmented highlights', () => {
      // Synthetic HAST: a parent element whose children straddle the match.
      // Structure: <span class="line" data-ln="1"><span class="pl-parent">
      //   <span class="pl-x">ab</span>=<span class="pl-y">cd</span>
      // </span></span>
      // Highlighting "b=c": match falls inside pl-parent at the top level
      // (single inject item), but inside pl-parent it straddles pl-x and pl-y.
      const root: HastRoot = {
        type: 'root',
        data: { totalLines: 1 },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'frame' },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'line', dataLn: 1 },
                children: [
                  {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['pl-parent'] },
                    children: [
                      {
                        type: 'element',
                        tagName: 'span',
                        properties: { className: ['pl-x'] },
                        children: [{ type: 'text', value: 'ab' }],
                      },
                      { type: 'text', value: '=' },
                      {
                        type: 'element',
                        tagName: 'span',
                        properties: { className: ['pl-y'] },
                        children: [{ type: 'text', value: 'cd' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const comments = { 1: ['@highlight-text "b=c"'] };
      const result = enhanceCodeEmphasis(root, comments, 'test.tsx') as HastRoot;
      const html = unified().use(rehypeStringify).stringify(result);

      expect(html).toContain('data-hl-part="start"');
      expect(html).toContain('data-hl-part="end"');
      // pl-x and pl-y must remain intact
      expect(html).toContain('<span class="pl-x">');
      expect(html).toContain('<span class="pl-y">');
    });

    it('should highlight all occurrences across element boundaries', async () => {
      const result = await testEmphasis(
        `<Input value={a} /> <Input value={b} /> // @highlight-text "value"`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `"<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1">&#x3C;<span class="pl-c1">Input</span> <span data-hl=""><span class="pl-e">value</span></span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">a</span><span class="pl-pse">}</span> /> &#x3C;<span class="pl-c1">Input</span> <span data-hl=""><span class="pl-e">value</span></span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">b</span><span class="pl-pse">}</span> /> <span class="pl-c">// @highlight-text "<span data-hl="">value</span>"</span></span></span>"`,
      );
    });

    it('should highlight repeated occurrences inside a single element', async () => {
      const result = await testEmphasis(
        `const x = "value value"; // @highlight-text "value"`,
        parseSource,
      );

      // Both "value" inside the string literal should be highlighted,
      // plus the one inside the comment text
      const matches = result.match(/data-hl=""/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2);

      // Verify both occurrences inside the pl-s string element are wrapped
      expect(result).toContain('<span class="pl-s"><span class="pl-pds">"</span>');
      expect(result).toContain('<span data-hl="">value</span> <span data-hl="">value</span>');
    });

    it('should highlight both leaf and cross-element occurrences of the same text', async () => {
      const result = await testEmphasis(
        `<Input value={value} /> {/* @highlight-text "value" */}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(
        `"<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1">&#x3C;<span class="pl-c1">Input</span> <span data-hl=""><span class="pl-e">value</span></span><span class="pl-k">=</span><span class="pl-pse">{</span><span data-hl=""><span class="pl-smi">value</span></span><span class="pl-pse">}</span> /></span></span>"`,
      );
    });
  });

  describe('strictHighlightText', () => {
    it('should allow highlights that wrap complete elements', async () => {
      // "value" is fully within a single pl-e element — no fragmentation needed
      const result = await testEmphasis(
        `<Input value={a} /> // @highlight-text "value"`,
        parseSource,
        'test.tsx',
        createEnhanceCodeEmphasis({ strictHighlightText: true }),
      );

      expect(result).toContain('data-hl=""');
      expect(result).not.toContain('data-hl-part');
    });

    it('should throw when a match straddles an element boundary', async () => {
      await expect(
        testEmphasis(
          `<MyComponent nativeButton={false}> // @highlight-text "Button={false}"`,
          parseSource,
          'test.tsx',
          createEnhanceCodeEmphasis({ strictHighlightText: true }),
        ),
      ).rejects.toThrow('straddles an element boundary');
    });

    it('should throw when a match straddles nested element boundaries', async () => {
      // Construct a synthetic HAST where a parent element contains child elements
      // and the highlight text straddles a nested element boundary.
      // Structure: <span class="line" data-ln="1"><span class="pl-parent">
      //   <span class="pl-x">ab</span>=<span class="pl-y">cd</span>
      // </span></span>
      // Highlighting "b=c" falls inside pl-parent at the top level (single inject),
      // but inside pl-parent it straddles pl-x (ends mid-element) and pl-y (starts mid-element).
      const root: HastRoot = {
        type: 'root',
        data: { totalLines: 1 },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'frame' },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: 'line', dataLn: 1 },
                children: [
                  {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['pl-parent'] },
                    children: [
                      {
                        type: 'element',
                        tagName: 'span',
                        properties: { className: ['pl-x'] },
                        children: [{ type: 'text', value: 'ab' }],
                      },
                      { type: 'text', value: '=' },
                      {
                        type: 'element',
                        tagName: 'span',
                        properties: { className: ['pl-y'] },
                        children: [{ type: 'text', value: 'cd' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const enhancer = createEnhanceCodeEmphasis({ strictHighlightText: true });
      const comments = { 1: ['@highlight-text "b=c"'] };

      expect(() => enhancer(root, comments, 'test.tsx')).toThrow('straddles an element boundary');
    });
  });

  describe('mixed emphasis', () => {
    it('should handle single and multiline together', async () => {
      const result = await testEmphasis(
        `const value = 42; // @highlight
function example() {
  // @highlight-start
  const x = 1;
  const y = 2;
  // @highlight-end
  return x + y;
}
const another = 99; // @highlight`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">value</span> <span class="pl-k">=</span> <span class="pl-c1">42</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2"><span class="line" data-ln="2"><span class="pl-k">function</span> <span class="pl-en">example</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="4" data-frame-type="highlighted-unfocused" data-frame-indent="1"><span class="line" data-ln="3">  <span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="4">  <span class="pl-k">const</span> <span class="pl-c1">y</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        </span><span class="frame" data-lined="" data-frame-start-line="5" data-frame-end-line="6"><span class="line" data-ln="5">  <span class="pl-k">return</span> <span class="pl-smi">x</span> <span class="pl-k">+</span> <span class="pl-smi">y</span>;</span>
        <span class="line" data-ln="6">}</span>
        </span>"
      `);
    });

    it('should highlight specific text within a multiline highlight region', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    // @highlight-start
    <div>
      <h1>Heading 1</h1> {/* @highlight-text "Heading 1" */}
      <p>Some content</p>
    </div>
    // @highlight-end
  );
}`,
        parseSource,
      );

      // The @highlight-text line should highlight "Heading 1" text inline
      expect(result).toContain('<span data-hl="">Heading 1</span>');
      // The line itself should NOT have line-level data-hl (simple highlight, frame handles it)
      // but the inline text highlight span is still present
      expect(result).not.toMatch(/data-ln="4"[^>]*data-hl=""/);
      // Other lines in the multiline region should also NOT have line-level data-hl
      expect(result).not.toMatch(/data-ln="3"[^>]*data-hl=""/);
      expect(result).not.toMatch(/data-ln="5"[^>]*data-hl=""/);
      expect(result).not.toMatch(/data-ln="6"[^>]*data-hl=""/);
      // The whole region should be in a highlighted frame
      expect(result).toContain('data-frame-type="highlighted"');
    });
  });

  describe('edge cases', () => {
    it('should ignore unmatched @highlight-end', async () => {
      const result = await testEmphasis(
        `const a = 1;
const b = 2;
// @highlight-end
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });

    it('should ignore unmatched @highlight-start', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @highlight-start
const b = 2;
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });

    it('should handle code without any @highlight comments', async () => {
      const result = await testEmphasis(
        `const a = 1;
const b = 2;
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });

    it('should ignore @highlight-text without quoted text', async () => {
      const result = await testEmphasis(
        `const a = 1; // @highlight-text
const b = 2;`,
        parseSource,
      );

      // Should not add any emphasis since there's no quoted text
      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span></span>"
      `);
    });
  });

  describe('real-world patterns', () => {
    it('should handle JSX inline comment pattern', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    <div>
      <h1>Heading 1</h1> {/* @highlight */}
      <p>Content</p>
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="5" data-frame-end-line="8"><span class="line" data-ln="5">      &#x3C;<span class="pl-ent">p</span>>Content&#x3C;/<span class="pl-ent">p</span>></span>
        <span class="line" data-ln="6">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="7">  );</span>
        <span class="line" data-ln="8">}</span></span>"
      `);
    });

    it('should handle complex nesting with descriptions', async () => {
      const result = await testEmphasis(
        `export default function Dashboard() {
  const [data, setData] = useState([]); // @highlight "We track state"
  return (
    <div>
      <Header />
      // @highlight-start "We render the main content"
      <Chart data={data} />
      <Table data={data} />
      // @highlight-end
      <Footer /> {/* @highlight */}
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Dashboard</span>() {</span>
        </span><span class="frame" data-lined="" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1" data-frame-description="We track state"><span class="line" data-ln="2">  <span class="pl-k">const</span> [<span class="pl-c1">data</span>, <span class="pl-c1">setData</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>([]);</span>
        </span><span class="frame" data-lined="" data-frame-start-line="3" data-frame-end-line="5"><span class="line" data-ln="3">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="4">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="5">      &#x3C;<span class="pl-c1">Header</span> /></span>
        </span><span class="frame" data-lined="" data-frame-start-line="6" data-frame-end-line="8" data-frame-type="highlighted-unfocused" data-frame-indent="3" data-frame-description="We render the main content"><span class="line" data-ln="6">      &#x3C;<span class="pl-c1">Chart</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="7">      &#x3C;<span class="pl-c1">Table</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="8">      &#x3C;<span class="pl-c1">Footer</span> /></span>
        </span><span class="frame" data-lined="" data-frame-start-line="9" data-frame-end-line="11"><span class="line" data-ln="9">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="10">  );</span>
        <span class="line" data-ln="11">}</span></span>"
      `);
    });
  });

  describe('preserved comments mode (displayComments)', () => {
    /**
     * Test helper for preserved comments mode (displayComments).
     * Comments are NOT removed from the source but are still collected for enhancement.
     */
    async function testEmphasisWithPreservedComments(
      code: string,
      parseSourceFn: ParseSource,
      fileName = 'test.tsx',
    ): Promise<string> {
      // Extract comments WITHOUT removing them (displayComments mode)
      const { comments: parsedComments } = await parseImportsAndComments(
        code,
        `file:///${fileName}`,
        {
          notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
          removeCommentsWithPrefix: undefined, // Don't remove comments
        },
      );

      // Convert 0-based to 1-based line numbers
      const comments: Record<number, string[]> = {};
      if (parsedComments) {
        for (const [lineStr, commentArray] of Object.entries(parsedComments)) {
          const zeroBasedLine = parseInt(lineStr, 10);
          const oneBasedLine = zeroBasedLine + 1;
          comments[oneBasedLine] = commentArray;
        }
      }

      // Parse the code WITH comments still present, then enhance
      const root = await parseSourceFn(code, fileName);
      const enhanced = enhanceCodeEmphasis(root, comments, fileName) as HastRoot;

      // Convert to HTML using rehype-stringify
      const html = unified().use(rehypeStringify).stringify(enhanced);

      return html;
    }

    it('should NOT highlight the @highlight-start line when comments are preserved', async () => {
      const result = await testEmphasisWithPreservedComments(
        `function Component() {
  return (
    // @highlight-start
    <div>
      <h1>Title</h1>
    </div>
    // @highlight-end
  );
}`,
        parseSource,
      );

      // Line 3 has @highlight-start comment - should NOT have data-hl
      // Lines 4-6 are in a highlighted frame but don't get line-level data-hl
      // (simple highlight, frame handles the visual emphasis)
      // Line 7 has @highlight-end comment - should NOT have data-hl

      // Check that line 3 (the @highlight-start line) does NOT have data-hl
      expect(result).toContain('data-ln="3"');
      expect(result).not.toMatch(/data-ln="3"[^>]*data-hl/);

      // Lines 4-6 should NOT have line-level data-hl (simple highlight, frame handles it)
      expect(result).not.toMatch(/data-ln="4"[^>]*data-hl/);
      expect(result).toContain('data-frame-type="highlighted"');

      // Check that line 7 (the @highlight-end line) does NOT have data-hl
      expect(result).toContain('data-ln="7"');
      expect(result).not.toMatch(/data-ln="7"[^>]*data-hl/);
    });

    it('should highlight single lines correctly when comments are preserved', async () => {
      const result = await testEmphasisWithPreservedComments(
        `const x = 1;
const y = 2; // @highlight
const z = 3;`,
        parseSource,
      );

      // Line 2 should NOT have line-level data-hl (simple highlight, frame handles it)
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl/);
      expect(result).toContain('data-frame-type="highlighted"');

      // Lines 1 and 3 should NOT have data-hl
      expect(result).not.toMatch(/data-ln="1"[^>]*data-hl/);
      expect(result).not.toMatch(/data-ln="3"[^>]*data-hl/);
    });

    it('should NOT highlight JSX comment lines with @highlight-start (braces syntax)', async () => {
      const result = await testEmphasisWithPreservedComments(
        `function Component() {
  return (
    <div>
      {/* @highlight-start */}
      <h1>Title</h1>
      {/* @highlight-end */}
    </div>
  );
}`,
        parseSource,
      );

      // Line 4 has {/* @highlight-start */} - should NOT have data-hl
      expect(result).toContain('data-ln="4"');
      expect(result).not.toMatch(/data-ln="4"[^>]*data-hl/);

      // Line 5 should NOT have line-level data-hl (simple highlight, frame handles it)
      expect(result).not.toMatch(/data-ln="5"[^>]*data-hl/);
      expect(result).toContain('data-frame-type="highlighted"');

      // Line 6 has {/* @highlight-end */} - should NOT have data-hl
      expect(result).toContain('data-ln="6"');
      expect(result).not.toMatch(/data-ln="6"[^>]*data-hl/);
    });

    it('should highlight text inside the comment and code with @highlight-text', async () => {
      const result = await testEmphasisWithPreservedComments(
        `export default function Component() {
  return (
    <div>
      <h1 className="primary">Heading 1</h1> {/* @highlight-text "primary" "Heading 1" */}
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-lined="" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-lined="" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span> <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span><span data-hl="">primary</span><span class="pl-pds">"</span></span>><span data-hl="">Heading 1</span>&#x3C;/<span class="pl-ent">h1</span>> <span class="pl-pse">{</span><span class="pl-c">/* @highlight-text "<span data-hl="">primary</span>" "<span data-hl="">Heading 1</span>" */</span><span class="pl-pse">}</span></span>
        </span><span class="frame" data-lined="" data-frame-start-line="5" data-frame-end-line="7"><span class="line" data-ln="5">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });
  });

  describe('createEnhanceCodeEmphasis with padding', () => {
    it('should add padding frames around the focused highlight region', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 2,
      });

      const result = await testEmphasis(
        `const a = 1;
const b = 2;
const c = 3;
const d = 4; // @highlight
const e = 5;
const f = 6;
const g = 7;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Line 4 is highlighted; padding of 2 above (lines 2-3) and 2 below (lines 5-6)
      // Frame 1 (normal): line 1
      // Frame 2 (padding-top): lines 2-3
      // Frame 3 (highlighted): line 4
      // Frame 4 (padding-bottom): lines 5-6
      // Frame 5 (normal): line 7
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="highlighted"');
      expect(result).toContain('data-frame-type="padding-bottom"');

      // Verify frame boundaries
      expect(result).toMatch(
        /data-frame-start-line="2" data-frame-end-line="3" data-frame-type="padding-top"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="5" data-frame-end-line="6" data-frame-type="padding-bottom"/,
      );
    });

    it('should limit total focus area with focusFramesMaxSize', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 5,
        focusFramesMaxSize: 5,
      });

      const result = await testEmphasis(
        `const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
const f = 6; // @highlight
const g = 7; // @highlight
const h = 8; // @highlight
const i = 9;
const j = 10;
const k = 11;
const l = 12;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Highlighted region: lines 6-8 (3 lines)
      // focusFramesMaxSize = 5, so remaining for padding = 5 - 3 = 2
      // floor(2/2)=1 top, ceil(2/2)=1 bottom
      // Even though paddingFrameMaxSize is 5, focusFramesMaxSize caps it
      expect(result).toMatch(
        /data-frame-start-line="5" data-frame-end-line="5" data-frame-type="padding-top"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="6" data-frame-end-line="8" data-frame-type="highlighted"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="9" data-frame-end-line="9" data-frame-type="padding-bottom"/,
      );
    });

    it('should not add padding when paddingFrameMaxSize is 0', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 0,
      });

      const result = await testEmphasis(
        `const a = 1;
const b = 2; // @highlight
const c = 3;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // No padding frames at all, same as default
      expect(result).not.toContain('data-frame-type="padding-top"');
      expect(result).not.toContain('data-frame-type="padding-bottom"');
      expect(result).toContain('data-frame-type="highlighted"');
    });
  });

  describe('@focus directive', () => {
    it('should add padding around the @focus region instead of the first', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1; // @highlight
const b = 2;
const c = 3;
const d = 4; // @highlight @focus
const e = 5;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Two highlight regions: line 1 and line 4
      // @focus is on line 4, so padding goes around line 4
      // Padding top: line 3, padding bottom: line 5
      expect(result).toMatch(
        /data-frame-start-line="3" data-frame-end-line="3" data-frame-type="padding-top"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="4" data-frame-end-line="4" data-frame-type="focus"/,
      );
      expect(result).toMatch(
        /data-frame-start-line="5" data-frame-end-line="5" data-frame-type="padding-bottom"/,
      );

      // Line 1 still highlighted but no padding around it (unfocused)
      expect(result).toMatch(
        /data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted-unfocused"/,
      );
    });

    it('should support @focus on @highlight-start', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1; // @highlight
const b = 2;
// @highlight-start @focus
const c = 3;
const d = 4;
// @highlight-end
const e = 5;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Focus is on the second region (lines 3-4 after comment stripping)
      // Padding goes around that region
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="padding-bottom"');
    });

    it('should support @focus combined with a description', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1; // @highlight
const b = 2;
const c = 3; // @highlight @focus "important line"
const d = 4;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // @focus on line 3 with description "important line"
      expect(result).toMatch(
        /data-frame-start-line="3" data-frame-end-line="3" data-frame-type="focus"/,
      );
      expect(result).toContain('data-hl-description="Important line"');
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="padding-bottom"');

      // Line 1 is highlighted-unfocused
      expect(result).toMatch(
        /data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted-unfocused"/,
      );
    });

    it('should preserve data-hl-position="single" for @highlight inside @focus range', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @focus-start
const b = 2;
const c = 3; // @highlight
const d = 4;
// @focus-end
const e = 5;`,
        parseSource,
      );

      // The single @highlight inside focus should get line-level data-hl with position="single"
      expect(result).toContain('data-hl="" data-hl-position="single"');
    });

    it('should put description on frame for standalone @highlight with description', async () => {
      const result = await testEmphasis(
        `const a = 1;
const b = 2; // @highlight "tracked variable"
const c = 3;`,
        parseSource,
      );

      // Frame-level description: the highlighted frame gets the description
      expect(result).toContain('data-frame-description="Tracked variable"');
      // No line-level description since the frame handles the highlight
      expect(result).not.toContain('data-hl-description');
    });

    it('should put description on frame for @highlight-start with description', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @highlight-start "region description"
const b = 2;
const c = 3;
// @highlight-end
const d = 4;`,
        parseSource,
      );

      // Frame-level description: the highlighted frame gets the description
      expect(result).toContain('data-frame-description="Region description"');
      // No line-level description since the frame handles the highlight
      expect(result).not.toContain('data-hl-description');
    });
  });

  describe('standalone @focus directives (focus without highlight)', () => {
    it('should focus a single line with @focus without highlighting it', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1;
const b = 2; // @focus
const c = 3;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Line 2 is focused but NOT line-highlighted (no data-hl)
      expect(result).toMatch(
        /data-frame-start-line="2" data-frame-end-line="2" data-frame-type="focus"/,
      );
      expect(result).not.toContain('data-hl=""');

      // Padding frames around the focused region
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="padding-bottom"');
    });

    it('should focus a multiline region with @focus-start/@focus-end without highlighting', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1;
// @focus-start
const b = 2;
const c = 3;
// @focus-end
const d = 4;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Lines 2-3 are focused but NOT line-highlighted
      expect(result).toMatch(/data-frame-type="focus"/);
      expect(result).not.toContain('data-hl=""');

      // Padding frames around the focused region
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="padding-bottom"');
    });

    it('should focus with @focus while @highlight highlights separately', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1; // @highlight
const b = 2;
const c = 3; // @focus
const d = 4;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Line 1 is highlighted-unfocused (no line-level data-hl, frame handles it)
      expect(result).toMatch(
        /data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted-unfocused"/,
      );
      expect(result).not.toContain('data-hl=""');

      // Line 3 is focused (focus frame type) but no data-hl
      expect(result).toMatch(
        /data-frame-start-line="3" data-frame-end-line="3" data-frame-type="focus"/,
      );

      // Padding frames around @focus region
      expect(result).toContain('data-frame-type="padding-top"');
      expect(result).toContain('data-frame-type="padding-bottom"');
    });

    it('FOCUS_COMMENT_PREFIX should export the correct prefix', () => {
      expect(FOCUS_COMMENT_PREFIX).toBe('@focus');
    });
  });

  describe('nested focus and highlight line-level data-hl', () => {
    it('should apply data-hl on @highlight lines inside a @focus region', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1;
// @focus-start
const b = 2;
const c = 3; // @highlight
const d = 4;
// @focus-end
const e = 5;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // The region has both focus and highlight. Focus takes precedence for the frame
      // type — highlights within are handled at the line level (data-hl).
      expect(result).toContain('data-frame-type="focus"');

      // Line c has both focus and highlight → should get data-hl=""
      expect(result).toMatch(/data-ln="3"[^>]*data-hl=""/);

      // Lines b and d are focus-only (no @highlight) → no data-hl
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl/);
      expect(result).not.toMatch(/data-ln="4"[^>]*data-hl/);
    });

    it('should apply data-hl on @highlight-start range inside a @focus region', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1;
// @focus-start
const b = 2;
// @highlight-start
const c = 3;
const d = 4;
// @highlight-end
const e = 5;
// @focus-end
const f = 6;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Lines c and d are inside both focus and highlight → data-hl=""
      expect(result).toMatch(/data-ln="3"[^>]*data-hl=""/);
      expect(result).toMatch(/data-ln="4"[^>]*data-hl=""/);

      // Lines b and e are focus-only → no data-hl
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl/);
      expect(result).not.toMatch(/data-ln="5"[^>]*data-hl/);
    });

    it('should apply data-hl="strong" for nested @highlight inside @highlight inside @focus', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 1,
      });

      const result = await testEmphasis(
        `const a = 1;
// @focus-start
// @highlight-start
const b = 2;
const c = 3; // @highlight
const d = 4;
// @highlight-end
// @focus-end
const e = 5;`,
        parseSource,
        'test.tsx',
        enhancer,
      );

      // Lines b and d are highlight+focus → data-hl=""
      expect(result).toMatch(/data-ln="2"[^>]*data-hl=""/);
      expect(result).toMatch(/data-ln="4"[^>]*data-hl=""/);

      // Line c is nested highlight (two depths) + focus → data-hl="strong"
      expect(result).toMatch(/data-ln="3"[^>]*data-hl="strong"/);
    });

    it('should not apply data-hl on simple highlight lines (frame handles it)', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @highlight-start
const b = 2;
const c = 3;
// @highlight-end
const d = 4;`,
        parseSource,
      );

      // Frame should be highlighted
      expect(result).toContain('data-frame-type="highlighted"');

      // Lines b and c should NOT have line-level data-hl (simple highlight, frame handles it)
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl/);
      expect(result).not.toMatch(/data-ln="3"[^>]*data-hl/);
    });

    it('should apply data-hl="strong" for @highlight inside @highlight (highlight inside highlighted frame)', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @highlight-start
const b = 2;
const c = 3; // @highlight
const d = 4;
// @highlight-end
const e = 5;`,
        parseSource,
      );

      // Frame should be highlighted
      expect(result).toContain('data-frame-type="highlighted"');

      // Lines b and d are simple highlight → no data-hl (frame handles it)
      expect(result).not.toMatch(/data-ln="2"[^>]*data-hl=""/);
      expect(result).not.toMatch(/data-ln="4"[^>]*data-hl=""/);

      // Line c is nested (highlight inside highlight) → data-hl="strong"
      expect(result).toMatch(/data-ln="3"[^>]*data-hl="strong"/);
    });
  });

  describe('data-frame-indent', () => {
    it('should set data-frame-indent based on minimum indentation', async () => {
      const result = await testEmphasis(
        `function test() {
    const a = 1; // @highlight
    const b = 2; // @highlight
  return null;
}`,
        parseSource,
      );

      // Lines 2-3 are highlighted with 4 spaces indent, indent level = 4/2 = 2
      expect(result).toMatch(/data-frame-type="highlighted" data-frame-indent="2"/);
    });
  });
});

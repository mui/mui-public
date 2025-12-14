import { describe, it, expect, beforeAll } from 'vitest';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { createParseSource } from '../parseSource';
import { enhanceCodeEmphasis, EMPHASIS_COMMENT_PREFIX } from './enhanceCodeEmphasis';
import { parseImportsAndComments } from '../loaderUtils/parseImportsAndComments';
import type { HastRoot, ParseSource } from '../../CodeHighlighter/types';

/**
 * Test helper to parse code, enhance it, and return HTML via rehype-stringify.
 */
async function testEmphasis(
  code: string,
  parseSource: ParseSource,
  fileName = 'test.tsx',
): Promise<string> {
  // Extract comments from the code using parseImportsAndComments
  // This also returns code with comments removed
  const { comments: parsedComments, code: codeWithoutComments } = await parseImportsAndComments(
    code,
    `file:///${fileName}`,
    {
      notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
      removeCommentsWithPrefix: [EMPHASIS_COMMENT_PREFIX],
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
  const enhanced = enhanceCodeEmphasis(root, comments, fileName) as HastRoot;

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
      expect(EMPHASIS_COMMENT_PREFIX).toBe('@demo see');
    });
  });

  describe('single line emphasis', () => {
    it('should emphasize a single line with @demo see here', async () => {
      const result = await testEmphasis(
        `export default function Button() {
  return (
    <button className="primary">Click me</button> // @demo see here
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="5"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Button</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="" data-hl-position="single">    &#x3C;<span class="pl-ent">button</span> <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>primary<span class="pl-pds">"</span></span>>Click me&#x3C;/<span class="pl-ent">button</span>> </span>
        <span class="line" data-ln="4">  );</span>
        <span class="line" data-ln="5">}</span></span>"
      `);
    });

    it('should emphasize multiple single lines', async () => {
      const result = await testEmphasis(
        `const a = 1; // @demo see here
const b = 2;
const c = 3; // @demo see here
const d = 4;
const e = 5; // @demo see here`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="4"><span class="line" data-ln="1" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>; </span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>; </span>
        <span class="line" data-ln="4"><span class="pl-k">const</span> <span class="pl-c1">d</span> <span class="pl-k">=</span> <span class="pl-c1">4</span>;</span>
        </span>"
      `);
    });

    it('should handle @demo see here with description', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  const [count, setCount] = useState(0); // @demo see here where we track state
  return <div>{count}</div>;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="4"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2" data-hl="" data-hl-description="We track state" data-hl-position="single">  <span class="pl-k">const</span> [<span class="pl-c1">count</span>, <span class="pl-c1">setCount</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>(<span class="pl-c1">0</span>); </span>
        <span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">div</span>><span class="pl-pse">{</span><span class="pl-smi">count</span><span class="pl-pse">}</span>&#x3C;/<span class="pl-ent">div</span>>;</span>
        <span class="line" data-ln="4">}</span></span>"
      `);
    });

    it('should use data-hl="strong" when description ends with !', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  const url = getUrl(); // @demo see here where we must provide the URL!
  return <a href={url}>Link</a>;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="4"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2" data-hl="strong" data-hl-description="We must provide the URL" data-hl-position="single">  <span class="pl-k">const</span> <span class="pl-c1">url</span> <span class="pl-k">=</span> <span class="pl-en">getUrl</span>(); </span>
        <span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">a</span> <span class="pl-e">href</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">url</span><span class="pl-pse">}</span>>Link&#x3C;/<span class="pl-ent">a</span>>;</span>
        <span class="line" data-ln="4">}</span></span>"
      `);
    });
  });

  describe('multiline emphasis', () => {
    it('should emphasize lines between @demo see below and @demo see above', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    // @demo see below
    <div>
      <h1>Heading 1</h1>
      <p>Some content</p>
    </div>
    // @demo see above
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="8"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="">      &#x3C;<span class="pl-ent">p</span>>Some content&#x3C;/<span class="pl-ent">p</span>></span>
        <span class="line" data-ln="6" data-hl="" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="7">  );</span>
        <span class="line" data-ln="8">}</span></span>"
      `);
    });

    it('should handle adjacent start and end (no lines between)', async () => {
      const result = await testEmphasis(
        `function test() {
  // @demo see below
  // @demo see above
  return null;
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> <span class="pl-c1">null</span>;</span>
        <span class="line" data-ln="3">}</span></span>"
      `);
    });

    it('should handle single line content between stripped comments', async () => {
      // When comments are stripped, a single line between them should be emphasized
      const result = await testEmphasis(
        `function test() {
  // @demo see below
  return null;
  // @demo see above
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
        <span class="line" data-ln="2" data-hl="">  <span class="pl-k">return</span> <span class="pl-c1">null</span>;</span>
        <span class="line" data-ln="3">}</span></span>"
      `);
    });

    it('should handle @demo see below with description', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    // @demo see below where we add a heading with an h1
    <div>
      <h1>Heading 1</h1>
    </div>
    // @demo see above
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="7"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="" data-hl-description="We add a heading with an h1" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });

    it('should handle nested multiline emphasis', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  // @demo see below
  return (
    // @demo see below
    <div>
      <h1>Heading 1</h1>
    </div>
    // @demo see above
  );
  // @demo see above
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="7"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2" data-hl="" data-hl-position="start">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="strong" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="strong">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="strong" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6" data-hl="" data-hl-position="end">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
    });
  });

  describe('mixed emphasis', () => {
    it('should handle single and multiline together', async () => {
      const result = await testEmphasis(
        `const value = 42; // @demo see here
function example() {
  // @demo see below
  const x = 1;
  const y = 2;
  // @demo see above
  return x + y;
}
const another = 99; // @demo see here`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="6"><span class="line" data-ln="1" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">value</span> <span class="pl-k">=</span> <span class="pl-c1">42</span>; </span>
        <span class="line" data-ln="2"><span class="pl-k">function</span> <span class="pl-en">example</span>() {</span>
        <span class="line" data-ln="3" data-hl="" data-hl-position="start">  <span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="4" data-hl="" data-hl-position="end">  <span class="pl-k">const</span> <span class="pl-c1">y</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="5">  <span class="pl-k">return</span> <span class="pl-smi">x</span> <span class="pl-k">+</span> <span class="pl-smi">y</span>;</span>
        <span class="line" data-ln="6">}</span>
        </span>"
      `);
    });
  });

  describe('edge cases', () => {
    it('should ignore unmatched @demo see above', async () => {
      const result = await testEmphasis(
        `const a = 1;
const b = 2;
// @demo see above
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });

    it('should ignore unmatched @demo see below', async () => {
      const result = await testEmphasis(
        `const a = 1;
// @demo see below
const b = 2;
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });

    it('should handle code without any @demo comments', async () => {
      const result = await testEmphasis(
        `const a = 1;
const b = 2;
const c = 3;`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        <span class="line" data-ln="3"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span></span>"
      `);
    });
  });

  describe('real-world patterns', () => {
    it('should handle JSX inline comment pattern', async () => {
      const result = await testEmphasis(
        `export default function Component() {
  return (
    <div>
      <h1>Heading 1</h1> {/* @demo see here */}
      <p>Content</p>
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="8"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="" data-hl-position="single">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>> <span class="pl-pse">{}</span></span>
        <span class="line" data-ln="5">      &#x3C;<span class="pl-ent">p</span>>Content&#x3C;/<span class="pl-ent">p</span>></span>
        <span class="line" data-ln="6">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="7">  );</span>
        <span class="line" data-ln="8">}</span></span>"
      `);
    });

    it('should handle complex nesting with descriptions', async () => {
      const result = await testEmphasis(
        `export default function Dashboard() {
  const [data, setData] = useState([]); // @demo see here where we track state
  return (
    <div>
      <Header />
      // @demo see below where we render the main content
      <Chart data={data} />
      <Table data={data} />
      // @demo see above
      <Footer /> {/* @demo see here */}
    </div>
  );
}`,
        parseSource,
      );

      expect(result).toMatchInlineSnapshot(`
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="11"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Dashboard</span>() {</span>
        <span class="line" data-ln="2" data-hl="" data-hl-description="We track state" data-hl-position="single">  <span class="pl-k">const</span> [<span class="pl-c1">data</span>, <span class="pl-c1">setData</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>([]); </span>
        <span class="line" data-ln="3">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="4">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="5">      &#x3C;<span class="pl-c1">Header</span> /></span>
        <span class="line" data-ln="6" data-hl="" data-hl-description="We render the main content" data-hl-position="start">      &#x3C;<span class="pl-c1">Chart</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="7" data-hl="" data-hl-position="end">      &#x3C;<span class="pl-c1">Table</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="8" data-hl="" data-hl-position="single">      &#x3C;<span class="pl-c1">Footer</span> /> <span class="pl-pse">{}</span></span>
        <span class="line" data-ln="9">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="10">  );</span>
        <span class="line" data-ln="11">}</span></span>"
      `);
    });
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { createParseSource } from '../parseSource';
import {
  enhanceCodeEmphasis,
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Button</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="3" data-frame-type="highlighted" data-frame-indent="2"><span class="line" data-ln="3" data-hl="" data-hl-position="single">    &#x3C;<span class="pl-ent">button</span> <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s"><span class="pl-pds">"</span>primary<span class="pl-pds">"</span></span>>Click me&#x3C;/<span class="pl-ent">button</span>></span>
        </span><span class="frame" data-frame-start-line="4" data-frame-end-line="5"><span class="line" data-ln="4">  );</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2"><span class="line" data-ln="2"><span class="pl-k">const</span> <span class="pl-c1">b</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="3" data-frame-type="highlighted-unfocused" data-frame-indent="0"><span class="line" data-ln="3" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">c</span> <span class="pl-k">=</span> <span class="pl-c1">3</span>;</span>
        </span><span class="frame" data-frame-start-line="4" data-frame-end-line="4"><span class="line" data-ln="4"><span class="pl-k">const</span> <span class="pl-c1">d</span> <span class="pl-k">=</span> <span class="pl-c1">4</span>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="" data-hl-description="We track state" data-hl-position="single">  <span class="pl-k">const</span> [<span class="pl-c1">count</span>, <span class="pl-c1">setCount</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>(<span class="pl-c1">0</span>);</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="4"><span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">div</span>><span class="pl-pse">{</span><span class="pl-smi">count</span><span class="pl-pse">}</span>&#x3C;/<span class="pl-ent">div</span>>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="strong" data-hl-description="We must provide the URL" data-hl-position="single">  <span class="pl-k">const</span> <span class="pl-c1">url</span> <span class="pl-k">=</span> <span class="pl-en">getUrl</span>();</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="4"><span class="line" data-ln="3">  <span class="pl-k">return</span> &#x3C;<span class="pl-ent">a</span> <span class="pl-e">href</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">url</span><span class="pl-pse">}</span>>Link&#x3C;/<span class="pl-ent">a</span>>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="6" data-frame-type="highlighted" data-frame-indent="2"><span class="line" data-ln="3" data-hl="" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="">      &#x3C;<span class="pl-ent">p</span>>Some content&#x3C;/<span class="pl-ent">p</span>></span>
        <span class="line" data-ln="6" data-hl="" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-frame-start-line="7" data-frame-end-line="8"><span class="line" data-ln="7">  );</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">function</span> <span class="pl-en">test</span>() {</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="">  <span class="pl-k">return</span> <span class="pl-c1">null</span>;</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="3"><span class="line" data-ln="3">}</span></span>"
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="5" data-frame-type="highlighted" data-frame-indent="2"><span class="line" data-ln="3" data-hl="" data-hl-description="We add a heading with an h1" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-frame-start-line="6" data-frame-end-line="7"><span class="line" data-ln="6">  );</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="6" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="" data-hl-position="start">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3" data-hl="strong" data-hl-position="start">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="4" data-hl="strong">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        <span class="line" data-ln="5" data-hl="strong" data-hl-position="end">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6" data-hl="" data-hl-position="end">  );</span>
        </span><span class="frame" data-frame-start-line="7" data-frame-end-line="7"><span class="line" data-ln="7">}</span></span>"
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4">      &#x3C;<span class="pl-ent">h1</span>><span data-hl="">Heading 1</span>&#x3C;/<span class="pl-ent">h1</span>></span>
        </span><span class="frame" data-frame-start-line="5" data-frame-end-line="7"><span class="line" data-ln="5">    &#x3C;/<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="6">  );</span>
        <span class="line" data-ln="7">}</span></span>"
      `);
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1" data-frame-type="highlighted" data-frame-indent="0"><span class="line" data-ln="1" data-hl="" data-hl-position="single"><span class="pl-k">const</span> <span class="pl-c1">value</span> <span class="pl-k">=</span> <span class="pl-c1">42</span>;</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2"><span class="line" data-ln="2"><span class="pl-k">function</span> <span class="pl-en">example</span>() {</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="4" data-frame-type="highlighted-unfocused" data-frame-indent="1"><span class="line" data-ln="3" data-hl="" data-hl-position="start">  <span class="pl-k">const</span> <span class="pl-c1">x</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
        <span class="line" data-ln="4" data-hl="" data-hl-position="end">  <span class="pl-k">const</span> <span class="pl-c1">y</span> <span class="pl-k">=</span> <span class="pl-c1">2</span>;</span>
        </span><span class="frame" data-frame-start-line="5" data-frame-end-line="6"><span class="line" data-ln="5">  <span class="pl-k">return</span> <span class="pl-smi">x</span> <span class="pl-k">+</span> <span class="pl-smi">y</span>;</span>
        <span class="line" data-ln="6">}</span>
        </span>"
      `);
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="2"><span class="line" data-ln="1"><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-k">=</span> <span class="pl-c1">1</span>;</span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="3"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Component</span>() {</span>
        <span class="line" data-ln="2">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="3">    &#x3C;<span class="pl-ent">div</span>></span>
        </span><span class="frame" data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted" data-frame-indent="3"><span class="line" data-ln="4" data-hl="" data-hl-position="single">      &#x3C;<span class="pl-ent">h1</span>>Heading 1&#x3C;/<span class="pl-ent">h1</span>></span>
        </span><span class="frame" data-frame-start-line="5" data-frame-end-line="8"><span class="line" data-ln="5">      &#x3C;<span class="pl-ent">p</span>>Content&#x3C;/<span class="pl-ent">p</span>></span>
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
        "<span class="frame" data-frame-start-line="1" data-frame-end-line="1"><span class="line" data-ln="1"><span class="pl-k">export</span> <span class="pl-k">default</span> <span class="pl-k">function</span> <span class="pl-en">Dashboard</span>() {</span>
        </span><span class="frame" data-frame-start-line="2" data-frame-end-line="2" data-frame-type="highlighted" data-frame-indent="1"><span class="line" data-ln="2" data-hl="" data-hl-description="We track state" data-hl-position="single">  <span class="pl-k">const</span> [<span class="pl-c1">data</span>, <span class="pl-c1">setData</span>] <span class="pl-k">=</span> <span class="pl-en">useState</span>([]);</span>
        </span><span class="frame" data-frame-start-line="3" data-frame-end-line="5"><span class="line" data-ln="3">  <span class="pl-k">return</span> (</span>
        <span class="line" data-ln="4">    &#x3C;<span class="pl-ent">div</span>></span>
        <span class="line" data-ln="5">      &#x3C;<span class="pl-c1">Header</span> /></span>
        </span><span class="frame" data-frame-start-line="6" data-frame-end-line="8" data-frame-type="highlighted-unfocused" data-frame-indent="3"><span class="line" data-ln="6" data-hl="" data-hl-description="We render the main content" data-hl-position="start">      &#x3C;<span class="pl-c1">Chart</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="7" data-hl="" data-hl-position="end">      &#x3C;<span class="pl-c1">Table</span> <span class="pl-e">data</span><span class="pl-k">=</span><span class="pl-pse">{</span><span class="pl-smi">data</span><span class="pl-pse">}</span> /></span>
        <span class="line" data-ln="8" data-hl="" data-hl-position="single">      &#x3C;<span class="pl-c1">Footer</span> /></span>
        </span><span class="frame" data-frame-start-line="9" data-frame-end-line="11"><span class="line" data-ln="9">    &#x3C;/<span class="pl-ent">div</span>></span>
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
      // Line 4 (<div>) should have data-hl with position="start"
      // Line 5 (<h1>) should have data-hl
      // Line 6 (</div>) should have data-hl with position="end"
      // Line 7 has @highlight-end comment - should NOT have data-hl

      // Check that line 3 (the @highlight-start line) does NOT have data-hl
      expect(result).toContain('data-ln="3"');
      expect(result).not.toMatch(/data-ln="3"[^>]*data-hl/);

      // Check that line 4 has data-hl (first content line)
      expect(result).toMatch(/data-ln="4"[^>]*data-hl/);

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

      // Line 2 has the @highlight comment and should be highlighted
      expect(result).toMatch(/data-ln="2"[^>]*data-hl/);

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

      // Line 5 (<h1>) should have data-hl with position="single" (only line in range)
      expect(result).toMatch(/data-ln="5"[^>]*data-hl/);

      // Line 6 has {/* @highlight-end */} - should NOT have data-hl
      expect(result).toContain('data-ln="6"');
      expect(result).not.toMatch(/data-ln="6"[^>]*data-hl/);
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

    it('should limit total focus area with focusFramesMaxLength', async () => {
      const enhancer = createEnhanceCodeEmphasis({
        paddingFrameMaxSize: 5,
        focusFramesMaxLength: 5,
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
      // focusFramesMaxLength = 5, so remaining for padding = 5 - 3 = 2
      // floor(2/2)=1 top, ceil(2/2)=1 bottom
      // Even though paddingFrameMaxSize is 5, focusFramesMaxLength caps it
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
        /data-frame-start-line="4" data-frame-end-line="4" data-frame-type="highlighted"/,
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

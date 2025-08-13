import { describe, it, expect, vi } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { transformHtmlCode } from './transformHtmlCode';
import type { VariantCode } from '../../CodeHighlighter/types';

// Mock the loadVariant function
vi.mock('../../CodeHighlighter/loadVariant', () => ({
  loadVariant: vi.fn(async (url: string, variantName: string, variant: VariantCode) => {
    // Simple mock that just returns the input with some transforms applied
    return {
      code: {
        ...variant,
        transforms: { 'mock-transform': { delta: {}, fileName: 'mock.js' } },
      },
      dependencies: [url],
    };
  }),
}));

describe('transformHtmlCode', () => {
  const getAstFromHtml = async (html: string) => {
    const processor = unified().use(rehypeParse, { fragment: true }).use(transformHtmlCode);
    const tree = await processor.run(processor.parse(html));
    return tree as any;
  };

  // More realistic test that mimics Next.js MDX processing pipeline
  const getAstFromMarkdown = async (markdown: string) => {
    const processor = unified()
      .use(remarkParse) // Parse markdown
      .use(remarkRehype, { allowDangerousHtml: true }) // Convert markdown to HTML AST
      .use(transformHtmlCode); // Apply our rehype plugin

    const tree = await processor.run(processor.parse(markdown));
    return tree as any;
  };

  const findPreElement = (node: any): any => {
    if (node.type === 'element' && node.tagName === 'pre') {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = findPreElement(child);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };

  it('should transform simple JavaScript code block', async () => {
    const html = '<pre><code class="language-js">console.log("hello");</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();
    expect(preElement.properties?.dataPrecompute).toBeTruthy();

    // Pre element should have error message
    expect(preElement.children).toHaveLength(1);
    expect(preElement.children[0].type).toBe('text');
    expect(preElement.children[0].value).toBe(
      'Error: expected pre tag to be handled by CodeHighlighter',
    );

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default).toBeTruthy();
    expect(precomputeData.Default.fileName).toBe('index.js');
  });

  it('should extract filename from language class', async () => {
    const html = '<pre><code class="language-typescript">const x: string = "test";</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();
    expect(preElement.properties?.dataPrecompute).toBeTruthy();

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBe('index.ts');
  });

  it('should use data-filename when provided', async () => {
    const html =
      '<pre><code class="language-js" data-filename="custom.jsx">const App = () => <div>Hello</div>;</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBe('custom.jsx');
  });

  it('should handle multiple code elements with different languages', async () => {
    const html = `<pre>calloutType;
      <code class="language-js">console.log("hello");</code>
      <code class="language-ts">console.log("hello" as string);</code>
    </pre>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData.Js).toBeTruthy();
    expect(precomputeData.Ts).toBeTruthy();
    expect(precomputeData.Js.fileName).toBe('index.js');
    expect(precomputeData.Ts.fileName).toBe('index.ts');
  });

  it('should skip empty code blocks', async () => {
    const html = '<pre><code class="language-js">   </code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    // Should still process but with empty content
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default?.source?.trim()).toBe('');
  });

  it('should handle code blocks without language class', async () => {
    const html = '<pre><code>console.log("hello");</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBeUndefined(); // no filename when no language class
  });

  it('should handle nested text content extraction', async () => {
    const html = '<pre><code class="language-js">const <span>x</span> = <em>42</em>;</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.source).toBe('const x = 42;');
  });

  it('should map various language extensions correctly', async () => {
    const testCases = [
      { lang: 'javascript', expected: 'index.js' },
      { lang: 'js', expected: 'index.js' },
      { lang: 'typescript', expected: 'index.ts' },
      { lang: 'ts', expected: 'index.ts' },
      { lang: 'tsx', expected: 'index.tsx' },
      { lang: 'jsx', expected: 'index.jsx' },
      { lang: 'json', expected: 'index.json' },
      { lang: 'markdown', expected: 'index.md' },
      { lang: 'md', expected: 'index.md' },
      { lang: 'mdx', expected: 'index.mdx' },
      { lang: 'html', expected: 'index.html' },
      { lang: 'css', expected: 'index.css' },
      { lang: 'shell', expected: 'index.sh' },
      { lang: 'bash', expected: 'index.sh' },
      { lang: 'sh', expected: 'index.sh' },
      { lang: 'yaml', expected: 'index.yaml' },
      { lang: 'yml', expected: 'index.yaml' },
      { lang: 'unknown', expected: undefined }, // no filename for unrecognized language
    ];

    // Process all test cases in parallel to avoid await in loop
    const results = await Promise.all(
      testCases.map(async ({ lang, expected }) => {
        const html = `<pre><code class="language-${lang}">code here</code></pre>`;
        const ast = await getAstFromHtml(html);
        const preElement = findPreElement(ast);
        const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
        return { expected, actual: precomputeData.Default.fileName };
      }),
    );

    // Verify all results
    results.forEach(({ expected, actual }) => {
      expect(actual).toBe(expected);
    });
  });

  it('should handle multiple code elements with same language (numbered variants)', async () => {
    const html = `<pre>
      <code class="language-js">console.log("variant 1");</code>
      <code class="language-js">console.log("variant 2");</code>
    </pre>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData['Variant 1']).toBeTruthy();
    expect(precomputeData['Variant 2']).toBeTruthy();
    expect(precomputeData['Variant 1'].fileName).toBe('index.js');
    expect(precomputeData['Variant 2'].fileName).toBe('index.js');
    expect(precomputeData['Variant 1'].source).toBe('console.log("variant 1");');
    expect(precomputeData['Variant 2'].source).toBe('console.log("variant 2");');
  });

  it('should respect data-variant attribute', async () => {
    const html = `<pre>
      <code class="language-js" data-variant="Main">console.log("main");</code>
      <code class="language-typescript" data-variant="TypeScript Version">console.log("ts" as string);</code>
    </pre>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData.Main).toBeTruthy();
    expect(precomputeData['TypeScript Version']).toBeTruthy();
    expect(precomputeData.Main.fileName).toBe('index.js');
    expect(precomputeData['TypeScript Version'].fileName).toBe('index.ts');
  });

  it('should replace pre content with error message', async () => {
    const html = `<pre><code class="language-js">console.log("hello");</code></pre>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement.children).toHaveLength(1);
    expect(preElement.children[0].type).toBe('text');
    expect(preElement.children[0].value).toBe(
      'Error: expected pre tag to be handled by CodeHighlighter',
    );
  });

  // Test with realistic Next.js MDX pipeline
  it('should work with markdown-to-HTML pipeline (realistic Next.js flow)', async () => {
    const markdown = `
Here's some JavaScript code:

\`\`\`js
console.log("hello from markdown");
\`\`\`

And TypeScript:

\`\`\`typescript
const message: string = "hello";
console.log(message);
\`\`\`
`;

    const ast = await getAstFromMarkdown(markdown);

    // Find all pre elements (should be 2)
    const preElements: any[] = [];
    const findAllPreElements = (node: any) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        preElements.push(node);
      }
      if (node.children) {
        for (const child of node.children) {
          findAllPreElements(child);
        }
      }
    };
    findAllPreElements(ast);

    expect(preElements).toHaveLength(2);

    // Test first pre element (JavaScript)
    const jsPreElement = preElements[0];
    expect(jsPreElement.properties?.dataPrecompute).toBeTruthy();

    const jsPrecomputeData = JSON.parse(jsPreElement.properties.dataPrecompute);
    expect(jsPrecomputeData.Default).toBeTruthy();
    expect(jsPrecomputeData.Default.fileName).toBe('index.js');
    expect(jsPrecomputeData.Default.source.trim()).toBe('console.log("hello from markdown");');

    // Test second pre element (TypeScript)
    const tsPreElement = preElements[1];
    expect(tsPreElement.properties?.dataPrecompute).toBeTruthy();

    const tsPrecomputeData = JSON.parse(tsPreElement.properties.dataPrecompute);
    expect(tsPrecomputeData.Default).toBeTruthy();
    expect(tsPrecomputeData.Default.fileName).toBe('index.ts');
    expect(tsPrecomputeData.Default.source.trim()).toBe(
      'const message: string = "hello";\nconsole.log(message);',
    );

    // Both should have error messages
    expect(jsPreElement.children).toHaveLength(1);
    expect(jsPreElement.children[0].value).toBe(
      'Error: expected pre tag to be handled by CodeHighlighter',
    );

    expect(tsPreElement.children).toHaveLength(1);
    expect(tsPreElement.children[0].value).toBe(
      'Error: expected pre tag to be handled by CodeHighlighter',
    );
  });

  // Test that would have caught the data.hProperties vs properties issue
  it('should demonstrate the difference between data.hProperties and properties in different pipelines', async () => {
    const html = '<pre><code class="language-js">console.log("test");</code></pre>';

    // Direct HTML parsing (what we were testing before)
    const htmlAst = await getAstFromHtml(html);
    const htmlPreElement = findPreElement(htmlAst);

    // Markdown -> HTML pipeline (realistic Next.js flow)
    const markdown = '```js\nconsole.log("test");\n```';
    const markdownAst = await getAstFromMarkdown(markdown);
    const markdownPreElement = findPreElement(markdownAst);

    // Both should have the data in properties (since our plugin now sets it correctly)
    expect(htmlPreElement.properties?.dataPrecompute).toBeTruthy();
    expect(markdownPreElement.properties?.dataPrecompute).toBeTruthy();

    // If we had used data.hProperties, the HTML-only test would pass but markdown test would fail
    // This test ensures both pipelines work the same way
    const htmlData = JSON.parse(htmlPreElement.properties.dataPrecompute);
    const markdownData = JSON.parse(markdownPreElement.properties.dataPrecompute);

    expect(htmlData.Default.fileName).toBe('index.js');
    expect(markdownData.Default.fileName).toBe('index.js');
    expect(htmlData.Default.source.trim()).toBe('console.log("test");');
    expect(markdownData.Default.source.trim()).toBe('console.log("test");');
  });
});

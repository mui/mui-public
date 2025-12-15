import { describe, it, expect, vi } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { transformHtmlCodePrecomputed } from './transformHtmlCodePrecomputed';
import { transformMarkdownCode } from '../transformMarkdownCode/transformMarkdownCode';
import type { VariantCode } from '../../CodeHighlighter/types';

// Mock the loadCodeVariant function
vi.mock('../loadCodeVariant/loadCodeVariant', () => ({
  loadCodeVariant: vi.fn(async (url: string, variantName: string, variant: VariantCode) => {
    // Import normalizeLanguage inside the mock to apply normalization
    const { normalizeLanguage: normalize } =
      await import('../loaderUtils/getLanguageFromExtension');

    // Simple mock that just returns the input with some transforms applied
    // Also normalize language like the real implementation does
    const normalizedLanguage = variant.language ? normalize(variant.language) : undefined;

    return {
      code: {
        ...variant,
        language: normalizedLanguage,
        transforms: { 'mock-transform': { delta: {}, fileName: 'mock.js' } },
      },
      dependencies: [url],
    };
  }),
}));

describe('transformHtmlCodePrecomputed', () => {
  const getAstFromHtml = async (html: string) => {
    const processor = unified()
      .use(rehypeParse, { fragment: true })
      .use(transformHtmlCodePrecomputed);
    const tree = await processor.run(processor.parse(html));
    return tree as any;
  };

  // More realistic test that mimics Next.js MDX processing pipeline
  const getAstFromMarkdown = async (markdown: string) => {
    const processor = unified()
      .use(remarkParse) // Parse markdown
      .use(transformMarkdownCode) // Convert markdown code blocks to semantic HTML
      .use(remarkRehype, { allowDangerousHtml: true }) // Convert markdown to HTML AST
      .use(transformHtmlCodePrecomputed); // Apply our rehype plugin

    const tree = await processor.run(processor.parse(markdown));
    return tree as any;
  };

  const findPreElement = (node: any): any => {
    if (node.type === 'element' && node.tagName === 'pre' && node.properties?.dataPrecompute) {
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

  it('should transform simple JavaScript code block in dl structure', async () => {
    const html =
      '<dl><dt><code>index.js</code></dt><dd><pre><code class="language-javascript">console.log("hello");</code></pre></dd></dl>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();
    expect(preElement.properties?.dataPrecompute).toBeTruthy();

    // Pre element should have error message
    expect(preElement.children).toHaveLength(1);
    expect(preElement.children[0].type).toBe('text');
    expect(preElement.children[0].value).toBe(
      'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
    );

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default).toBeTruthy();
    expect(precomputeData.Default.fileName).toBe('index.js');
  });

  it('should extract filename from dt element', async () => {
    const html =
      '<dl><dt><code>custom.tsx</code></dt><dd><pre><code class="language-typescript">const x: string = "test";</code></pre></dd></dl>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();
    expect(preElement.properties?.dataPrecompute).toBeTruthy();

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBe('custom.tsx');
  });

  it('should handle section with multiple figures', async () => {
    const html = `<section>
      <figure>
        <figcaption>JavaScript variant</figcaption>
        <dl>
          <dt><code>index.js</code></dt>
          <dd><pre><code class="language-javascript" data-variant="javascript">console.log("hello");</code></pre></dd>
        </dl>
      </figure>
      <figure>
        <figcaption>TypeScript variant</figcaption>
        <dl>
          <dt><code>index.ts</code></dt>
          <dd><pre><code class="language-typescript" data-variant="typescript">console.log("hello" as string);</code></pre></dd>
        </dl>
      </figure>
    </section>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData.JavaScript).toBeTruthy();
    expect(precomputeData.TypeScript).toBeTruthy();
    expect(precomputeData.JavaScript.fileName).toBe('index.js');
    expect(precomputeData.TypeScript.fileName).toBe('index.ts');
  });

  it('should skip empty code blocks', async () => {
    const html =
      '<dl><dt><code>index.js</code></dt><dd><pre><code class="language-javascript">   </code></pre></dd></dl>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    // Should still process but with empty content
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default?.source?.trim()).toBe('');
  });

  it('should handle dl without dt (no filename)', async () => {
    const html =
      '<dl><dd><pre><code class="language-javascript">console.log("hello");</code></pre></dd></dl>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBeUndefined(); // No explicit filename
    expect(precomputeData.Default.language).toBe('javascript'); // Language derived from class="language-*"
  });

  it('should handle nested text content extraction', async () => {
    const html =
      '<dl><dt><code>index.js</code></dt><dd><pre><code class="language-javascript">const <span>x</span> = <em>42</em>;</code></pre></dd></dl>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.source).toBe('const x = 42;');
  });

  it('should map various language extensions correctly', async () => {
    const testCases = [
      { lang: 'javascript', expected: 'javascript' },
      { lang: 'js', expected: 'javascript' }, // Normalized from 'js' to 'javascript'
      { lang: 'typescript', expected: 'typescript' },
      { lang: 'ts', expected: 'typescript' }, // Normalized from 'ts' to 'typescript'
      { lang: 'tsx', expected: 'tsx' },
      { lang: 'jsx', expected: 'jsx' },
      { lang: 'json', expected: 'json' },
      { lang: 'markdown', expected: 'markdown' },
      { lang: 'md', expected: 'markdown' }, // Normalized from 'md' to 'markdown'
      { lang: 'mdx', expected: 'mdx' },
      { lang: 'html', expected: 'html' },
      { lang: 'css', expected: 'css' },
      { lang: 'shell', expected: 'shell' },
      { lang: 'bash', expected: 'shell' }, // Normalized from 'bash' to 'shell'
      { lang: 'sh', expected: 'shell' }, // Normalized from 'sh' to 'shell'
      { lang: 'yaml', expected: 'yaml' },
      { lang: 'yml', expected: 'yaml' }, // Normalized from 'yml' to 'yaml'
      { lang: 'unknown', expected: 'unknown' }, // language is passed through as-is
    ];

    // Process all test cases in parallel to avoid await in loop
    const results = await Promise.all(
      testCases.map(async ({ lang, expected }) => {
        const html = `<dl><dd><pre><code class="language-${lang}">code here</code></pre></dd></dl>`;
        const ast = await getAstFromHtml(html);
        const preElement = findPreElement(ast);
        const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
        return {
          lang,
          expected,
          actualLanguage: precomputeData.Default.language,
          actualFileName: precomputeData.Default.fileName,
        };
      }),
    );

    // Verify all results - should have language, no fileName
    results.forEach(({ expected, actualLanguage, actualFileName }) => {
      expect(actualLanguage).toBe(expected);
      expect(actualFileName).toBeUndefined(); // No explicit filename
    });
  });

  it('should handle multiple code elements with different variants', async () => {
    const html = `<section>
      <figure>
        <figcaption>npm variant</figcaption>
        <dl>
          <dt><code>package.json</code></dt>
          <dd><pre><code class="language-json" data-variant="npm">{"name": "npm-example"}</code></pre></dd>
        </dl>
      </figure>
      <figure>
        <figcaption>yarn variant</figcaption>
        <dl>
          <dt><code>package.json</code></dt>
          <dd><pre><code class="language-json" data-variant="yarn">{"name": "yarn-example"}</code></pre></dd>
        </dl>
      </figure>
    </section>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData.npm).toBeTruthy();
    expect(precomputeData.yarn).toBeTruthy();
    expect(precomputeData.npm.fileName).toBe('package.json');
    expect(precomputeData.yarn.fileName).toBe('package.json');
    expect(precomputeData.npm.source).toBe('{"name": "npm-example"}');
    expect(precomputeData.yarn.source).toBe('{"name": "yarn-example"}');
  });

  it('should respect data-variant attribute', async () => {
    const html = `<section>
      <figure>
        <figcaption>Main variant</figcaption>
        <dl>
          <dt><code>index.js</code></dt>
          <dd><pre><code class="language-javascript" data-variant="Main">console.log("main");</code></pre></dd>
        </dl>
      </figure>
      <figure>
        <figcaption>TypeScript Version variant</figcaption>
        <dl>
          <dt><code>index.ts</code></dt>
          <dd><pre><code class="language-typescript" data-variant="TypeScript Version">console.log("ts" as string);</code></pre></dd>
        </dl>
      </figure>
    </section>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);

    expect(precomputeData.Main).toBeTruthy();
    expect(precomputeData['TypeScript Version']).toBeTruthy();
    expect(precomputeData.Main.fileName).toBe('index.js');
    expect(precomputeData['TypeScript Version'].fileName).toBe('index.ts');
  });

  it('should replace semantic structure content with error message', async () => {
    const html = `<dl><dt><code>index.js</code></dt><dd><pre><code class="language-javascript">console.log("hello");</code></pre></dd></dl>`;
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement.children).toHaveLength(1);
    expect(preElement.children[0].type).toBe('text');
    expect(preElement.children[0].value).toBe(
      'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
    );
  });

  it('should handle basic pre > code structure from standard markdown', async () => {
    const html = '<pre><code class="language-javascript">console.log("hello world");</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();
    expect(preElement.properties?.dataPrecompute).toBeTruthy();

    // Pre element should have error message
    expect(preElement.children).toHaveLength(1);
    expect(preElement.children[0].type).toBe('text');
    expect(preElement.children[0].value).toBe(
      'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
    );

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default).toBeTruthy();
    expect(precomputeData.Default.fileName).toBeUndefined(); // No explicit filename
    expect(precomputeData.Default.language).toBe('javascript'); // Language from class="language-*"
    expect(precomputeData.Default.source.trim()).toBe('console.log("hello world");');
  });

  it('should handle basic pre > code with custom data-filename', async () => {
    const html =
      '<pre><code class="language-typescript" data-filename="custom.ts">const x: string = "test";</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default.fileName).toBe('custom.ts');
    expect(precomputeData.Default.source.trim()).toBe('const x: string = "test";');
  });

  it('should handle basic pre > code without language class', async () => {
    const html = '<pre><code>plain text code</code></pre>';
    const ast = await getAstFromHtml(html);

    const preElement = findPreElement(ast);
    expect(preElement).toBeTruthy();

    const precomputeData = JSON.parse(preElement.properties.dataPrecompute);
    expect(precomputeData.Default).toBeTruthy();
    expect(precomputeData.Default.fileName).toBeUndefined(); // No language means no derived filename
    expect(precomputeData.Default.source.trim()).toBe('plain text code');
  });

  // Test with realistic Next.js MDX pipeline
  it('should work with markdown-to-HTML pipeline (realistic Next.js flow)', async () => {
    const markdown = `
Here's some JavaScript code:

\`\`\`js transform
console.log("hello from markdown");
\`\`\`

And TypeScript with variants:

\`\`\`typescript variant=main
const message: string = "hello";
console.log(message);
\`\`\`

\`\`\`typescript variant=alternative
const msg = "hello";
console.log(msg);
\`\`\`
`;

    const ast = await getAstFromMarkdown(markdown);

    // Find all pre elements (should be 2: one for single variant and one for multi-variant)
    const preElements: any[] = [];
    const findAllPreElements = (node: any) => {
      if (node.type === 'element' && node.tagName === 'pre' && node.properties?.dataPrecompute) {
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

    // Test first pre element (JavaScript - single variant)
    const singleVariantPre = preElements.find((el) => {
      const data = JSON.parse(el.properties.dataPrecompute);
      return data.Default;
    });
    expect(singleVariantPre.properties?.dataPrecompute).toBeTruthy();

    const singlePrecomputeData = JSON.parse(singleVariantPre.properties.dataPrecompute);
    expect(singlePrecomputeData.Default).toBeTruthy();
    expect(singlePrecomputeData.Default.fileName).toBeUndefined(); // No explicit filename means no fileName
    expect(singlePrecomputeData.Default.language).toBe('javascript'); // Language is derived from class
    expect(singlePrecomputeData.Default.source.trim()).toBe('console.log("hello from markdown");');

    // Test second pre element (TypeScript - multi-variant)
    const multiVariantPre = preElements.find((el) => {
      const data = JSON.parse(el.properties.dataPrecompute);
      return data.main && data.alternative;
    });
    expect(multiVariantPre.properties?.dataPrecompute).toBeTruthy();

    const multiPrecomputeData = JSON.parse(multiVariantPre.properties.dataPrecompute);
    expect(multiPrecomputeData.main).toBeTruthy();
    expect(multiPrecomputeData.alternative).toBeTruthy();
    expect(multiPrecomputeData.main.fileName).toBeUndefined(); // No explicit filename
    expect(multiPrecomputeData.alternative.fileName).toBeUndefined(); // No explicit filename
    expect(multiPrecomputeData.main.language).toBe('typescript');
    expect(multiPrecomputeData.alternative.language).toBe('typescript');

    // Both should have error messages
    expect(singleVariantPre.children).toHaveLength(1);
    expect(singleVariantPre.children[0].value).toBe(
      'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
    );

    expect(multiVariantPre.children).toHaveLength(1);
    expect(multiVariantPre.children[0].value).toBe(
      'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
    );
  });

  // Test that would have caught the data.hProperties vs properties issue
  it('should demonstrate the difference between data.hProperties and properties in different pipelines', async () => {
    const html =
      '<dl><dt><code>index.js</code></dt><dd><pre><code class="language-javascript">console.log("test");</code></pre></dd></dl>';

    // Direct HTML parsing (what we were testing before)
    const htmlAst = await getAstFromHtml(html);
    const htmlPreElement = findPreElement(htmlAst);

    // Markdown -> HTML pipeline (realistic Next.js flow)
    const markdown = '```js transform\nconsole.log("test");\n```';
    const markdownAst = await getAstFromMarkdown(markdown);
    const markdownPreElement = findPreElement(markdownAst);

    // Both should have the data in properties (since our plugin now sets it correctly)
    expect(htmlPreElement.properties?.dataPrecompute).toBeTruthy();
    expect(markdownPreElement.properties?.dataPrecompute).toBeTruthy();

    // If we had used data.hProperties, the HTML-only test would pass but markdown test would fail
    // This test ensures both pipelines work the same way
    const htmlData = JSON.parse(htmlPreElement.properties.dataPrecompute);
    const markdownData = JSON.parse(markdownPreElement.properties.dataPrecompute);

    expect(htmlData.Default.fileName).toBe('index.js'); // HTML has explicit filename in dt element
    expect(markdownData.Default.fileName).toBeUndefined(); // Markdown has no explicit filename
    expect(markdownData.Default.language).toBe('javascript'); // Language is derived from class="language-*"
    expect(htmlData.Default.source.trim()).toBe('console.log("test");');
    expect(markdownData.Default.source.trim()).toBe('console.log("test");');
  });
});

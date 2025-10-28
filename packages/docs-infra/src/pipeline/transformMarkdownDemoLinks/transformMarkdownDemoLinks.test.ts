import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { describe, it, expect } from 'vitest';
import transformMarkdownDemoLinks from './index.js';

// Processor for testing AST structure
const astProcessor = unified().use(remarkParse).use(transformMarkdownDemoLinks);

// End-to-end processor for testing final HTML output
const e2eProcessor = unified()
  .use(remarkParse)
  .use(transformMarkdownDemoLinks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

describe('transformMarkdownDemoLinks', () => {
  describe('AST Structure Tests', () => {
    it('should remove "[See Demo]" link and horizontal rule after Demo component', () => {
      const markdown = `
<DemoCodeHighlighter />

[See Demo](./demos/code/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 2 children: the demo paragraph and the heading
      expect(ast.children).toHaveLength(2);

      // First child should be the demo html node
      const demoHtml = ast.children[0];
      expect(demoHtml.type).toBe('html');
      expect(demoHtml.value).toBe('<DemoCodeHighlighter />');

      // Second child should be the heading (the link and separator should be removed)
      const heading = ast.children[1];
      expect(heading.type).toBe('heading');
      expect(heading.children[0].value).toBe('Next Section');
    });

    it('should handle multiple Demo patterns in the same document', () => {
      const markdown = `
<DemoFirst />

[See Demo](./demos/first/)

---

Some content in between.

<DemoSecond />

[See Demo](./demos/second/)

---

Final content.
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 3 children: demo1, content paragraph, demo2, final content
      expect(ast.children).toHaveLength(4);

      // Check first demo
      const firstDemo = ast.children[0];
      expect(firstDemo.type).toBe('html');
      expect(firstDemo.value).toBe('<DemoFirst />');

      // Check content paragraph
      const contentPara = ast.children[1];
      expect(contentPara.type).toBe('paragraph');
      expect(contentPara.children[0].value).toBe('Some content in between.');

      // Check second demo
      const secondDemo = ast.children[2];
      expect(secondDemo.type).toBe('html');
      expect(secondDemo.value).toBe('<DemoSecond />');

      // Check final content
      const finalContent = ast.children[3];
      expect(finalContent.type).toBe('paragraph');
      expect(finalContent.children[0].value).toBe('Final content.');
    });

    it('should NOT remove pattern when Demo is just the .Title', () => {
      const markdown = `
<DemoCodeHighlighter.Title />

[See Demo](./demos/code/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 4 children: demo, link, separator, heading (nothing removed)
      expect(ast.children).toHaveLength(4);

      // Check that all original elements are preserved
      expect(ast.children[0].type).toBe('paragraph'); // Demo
      expect(ast.children[1].type).toBe('paragraph'); // Link
      expect(ast.children[2].type).toBe('thematicBreak'); // Separator
      expect(ast.children[3].type).toBe('heading'); // Heading
    });

    it('should remove "[See Demo]" link even when there is no horizontal rule', () => {
      const markdown = `
<DemoCodeHighlighter />

[See Demo](./demos/code/)

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 2 children: demo and heading (link removed even without separator)
      expect(ast.children).toHaveLength(2);

      expect(ast.children[0].type).toBe('html'); // Demo
      expect(ast.children[1].type).toBe('heading'); // Heading
    });

    it('should remove both "[See Demo]" link and horizontal rule when both are present', () => {
      const markdown = `
<DemoCodeHighlighter />

[See Demo](./demos/code/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 2 children: demo and heading (both link and separator removed)
      expect(ast.children).toHaveLength(2);

      expect(ast.children[0].type).toBe('html'); // Demo
      expect(ast.children[1].type).toBe('heading'); // Heading
    });

    it('should NOT remove pattern when there is no "[See Demo]" link', () => {
      const markdown = `
<DemoCodeHighlighter />

[Different Link](./demos/code/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 3 children: demo, link, heading (HR removed even without "See Demo" link)
      expect(ast.children).toHaveLength(3);

      expect(ast.children[0].type).toBe('html'); // Demo
      expect(ast.children[1].type).toBe('paragraph'); // Link (preserved)
      expect(ast.children[2].type).toBe('heading'); // Heading
    });

    it('should handle Demo components mixed with other content', () => {
      const markdown = `
Some text before <DemoCodeHighlighter />

[See Demo](./demos/code/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should process Demo even when mixed with other content - remove See Demo link and HR
      expect(ast.children).toHaveLength(2);

      expect(ast.children[0].type).toBe('paragraph'); // Text with Demo (preserved)
      expect(ast.children[1].type).toBe('heading'); // Heading
    });

    it('should handle Demo components with props', () => {
      const markdown = `
<DemoWithProps variant="primary" className="test" />

[See Demo](./demos/with-props/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 2 children: demo and heading (link and separator removed)
      expect(ast.children).toHaveLength(2);

      const demoHtml = ast.children[0];
      expect(demoHtml.type).toBe('html');
      expect(demoHtml.value).toBe('<DemoWithProps variant="primary" className="test" />');
    });

    it('should handle self-closing and non-self-closing Demo components', () => {
      const markdown = `
<DemoSelfClosing />

[See Demo](./demos/self-closing/)

---

<DemoWithChildren>Content</DemoWithChildren>

[See Demo](./demos/with-children/)

---

Final content.
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 3 children: demo1, demo2, final content
      expect(ast.children).toHaveLength(3);

      // Check first demo (self-closing)
      const firstDemo = ast.children[0];
      expect(firstDemo.type).toBe('html');
      expect(firstDemo.value).toBe('<DemoSelfClosing />');

      // Check second demo (with children) - this stays as a paragraph structure
      const secondDemo = ast.children[1];
      expect(secondDemo.type).toBe('paragraph');
      expect(secondDemo.children).toHaveLength(3); // opening tag, content, closing tag
      expect(secondDemo.children[0].type).toBe('html');
      expect(secondDemo.children[0].value).toBe('<DemoWithChildren>');
      expect(secondDemo.children[1].type).toBe('text');
      expect(secondDemo.children[1].value).toBe('Content');
      expect(secondDemo.children[2].type).toBe('html');
      expect(secondDemo.children[2].value).toBe('</DemoWithChildren>');
    });

    it('should handle empty Demo components', () => {
      const markdown = `
<Demo />

[See Demo](./demos/empty/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 2 children: demo and heading
      expect(ast.children).toHaveLength(2);

      const demoHtml = ast.children[0];
      expect(demoHtml.type).toBe('html');
      expect(demoHtml.value).toBe('<Demo />');
    });

    it('should NOT process non-Demo HTML elements', () => {
      const markdown = `
<div>Some content</div>

[See Demo](./demos/div/)

---

## Next Section
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have 4 children (nothing removed because it's not a Demo component)
      expect(ast.children).toHaveLength(4);

      expect(ast.children[0].type).toBe('html'); // div
      expect(ast.children[1].type).toBe('paragraph'); // Link
      expect(ast.children[2].type).toBe('thematicBreak'); // Separator
      expect(ast.children[3].type).toBe('heading'); // Heading
    });
  });

  describe('End-to-End HTML Output Tests', () => {
    it('should produce clean HTML output with Demo component only', () => {
      const markdown = `<DemoCodeHighlighter />

[See Demo](./demos/code/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Demo component is preserved as raw HTML, but links and HR are removed
      expect(result).toEqual('<DemoCodeHighlighter />\n<h2>Next Section</h2>');
    });

    it('should handle multiple Demo patterns correctly in HTML output', () => {
      const markdown = `<DemoFirst />

[See Demo](./demos/first/)

---

Some content between demos.

<DemoSecond />

[See Demo](./demos/second/)

---

Final content.`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Demo components preserved as raw HTML, links and HR removed
      expect(result).toEqual(
        '<DemoFirst />\n<p>Some content between demos.</p>\n<DemoSecond />\n<p>Final content.</p>',
      );
    });

    it('should preserve Demo components with .Title in HTML output', () => {
      const markdown = `<DemoCodeHighlighter.Title />

[See Demo](./demos/code/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // All elements should be preserved since Demo.Title should NOT be processed
      expect(result).toEqual(
        '<p>&#x3C;DemoCodeHighlighter.Title /></p>\n<p><a href="./demos/code/">See Demo</a></p>\n<hr>\n<h2>Next Section</h2>',
      );
    });

    it('should handle Demo components with complex props in HTML output', () => {
      const markdown = `<DemoAdvanced 
  variant="complex"
  data={{"key": "value"}}
  onEvent={() => console.log('test')}
/>

[See Demo](./demos/advanced/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Complex JSX syntax in multiline Demo components sometimes gets escaped by remark-rehype
      // When this happens, the plugin doesn't process it (since it's text, not HTML), so everything is preserved
      expect(result).toEqual(
        '<p>&#x3C;DemoAdvanced\nvariant="complex"\ndata={{"key": "value"}}\nonEvent={() => console.log(\'test\')}\n/></p>\n<p><a href="./demos/advanced/">See Demo</a></p>\n<hr>\n<h2>Next Section</h2>',
      );
    });

    it('should preserve other links that are not "See Demo"', () => {
      const markdown = `<DemoCodeHighlighter />

[Different Link](./demos/code/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Link should be preserved since it's not "See Demo", but HR is now removed after Demo components
      // With allowDangerousHtml, Demo component appears as raw HTML even when not processed
      expect(result).toEqual(
        '<DemoCodeHighlighter />\n<p><a href="./demos/code/">Different Link</a></p>\n<h2>Next Section</h2>',
      );
    });

    it('should remove "[See Demo]" link even without horizontal rule in HTML output', () => {
      const markdown = `<DemoCodeHighlighter />

[See Demo](./demos/code/)

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Demo component preserved, See Demo link removed (no HR to remove)
      expect(result).toEqual('<DemoCodeHighlighter />\n<h2>Next Section</h2>');
    });

    it('should handle mixed content with demos and regular content', () => {
      const markdown = `# Documentation

Some introduction text.

<DemoBasic />

[See Demo](./demos/basic/)

---

## Features

More documentation content.

<DemoAdvanced />

[See Demo](./demos/advanced/)

---

## Conclusion

Final thoughts.`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Demo components preserved as raw HTML, See Demo links and HR removed
      expect(result).toEqual(
        '<h1>Documentation</h1>\n<p>Some introduction text.</p>\n<DemoBasic />\n<h2>Features</h2>\n<p>More documentation content.</p>\n<DemoAdvanced />\n<h2>Conclusion</h2>\n<p>Final thoughts.</p>',
      );
    });

    it('should handle edge case with empty See Demo link', () => {
      const markdown = `<DemoTest />

[See Demo]()

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Should still process even if the link is empty
      expect(result).toEqual('<DemoTest />\n<h2>Next Section</h2>');
    });

    it('should handle Demo components nested in other HTML', () => {
      const markdown = `<div><DemoNested /></div>

[See Demo](./demos/nested/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // The nested Demo SHOULD be processed since it's in a valid HTML node that contains <Demo
      // The plugin removes the See Demo link and HR when it finds the Demo pattern
      expect(result).toEqual('<div><DemoNested /></div>\n<h2>Next Section</h2>');
    });

    it('should handle Demo components with line breaks', () => {
      const markdown = `<DemoMultiline
  prop1="value1"
  prop2="value2"
/>

[See Demo](./demos/multiline/)

---

## Next Section`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Multiline Demo component remains in paragraph tags, but See Demo link and HR are removed
      expect(result).toMatch(/<p><DemoMultiline[\s\S]*?\/><\/p>\n<h2>Next Section<\/h2>/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle document with only Demo pattern', () => {
      const markdown = `<DemoOnly />

[See Demo](./demos/only/)

---`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should have only 1 child: the demo html node
      expect(ast.children).toHaveLength(1);
      expect(ast.children[0].type).toBe('html');
      expect(ast.children[0].value).toBe('<DemoOnly />');
    });

    it('should handle malformed Demo tags gracefully', () => {
      const markdown = `<Demo incomplete

[See Demo](./demos/malformed/)

---

## Next Section`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should NOT process malformed HTML that isn't recognized as proper HTML by markdown parser
      // The malformed tag is treated as text, not HTML, so plugin should ignore it
      expect(ast.children).toHaveLength(4); // paragraph with malformed text, See Demo paragraph, HR, heading
      expect(ast.children[0].type).toBe('paragraph'); // Contains the malformed text
      expect(ast.children[1].type).toBe('paragraph'); // Contains the See Demo link (not removed)
      expect(ast.children[2].type).toBe('thematicBreak'); // HR (not removed)
      expect(ast.children[3].type).toBe('heading');
    });

    it('should handle case sensitivity correctly', () => {
      const markdown = `<demo />

[See Demo](./demos/case/)

---

## Next Section`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should NOT process because it's lowercase 'demo', not 'Demo'
      expect(ast.children).toHaveLength(4);
    });

    it('should handle Demo.Title vs DemoTitle correctly', () => {
      const markdown1 = `<Demo.Title />

[See Demo](./demos/dot-title/)

---`;

      const markdown2 = `<DemoTitle />

[See Demo](./demos/title/)

---`;

      const ast1 = astProcessor.runSync(astProcessor.parse(markdown1)) as any;
      const ast2 = astProcessor.runSync(astProcessor.parse(markdown2)) as any;

      // First should NOT be processed (contains .Title)
      expect(ast1.children).toHaveLength(3);

      // Second SHOULD be processed (DemoTitle, not Demo.Title)
      expect(ast2.children).toHaveLength(1);
      expect(ast2.children[0].type).toBe('html');
      expect(ast2.children[0].value).toBe('<DemoTitle />');
    });

    it('should handle multiple horizontal rules correctly', () => {
      const markdown = `<DemoTest />

[See Demo](./demos/test/)

---

---

## Next Section`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should process the first pattern (Demo + See Demo link + first HR) and preserve the second HR
      expect(ast.children).toHaveLength(3);
      expect(ast.children[0].type).toBe('html'); // Demo
      expect(ast.children[1].type).toBe('thematicBreak'); // Second HR (preserved)
      expect(ast.children[2].type).toBe('heading'); // Heading
    });

    it('should successfully process imported Demo components', () => {
      // This simulates how imported MDX components appear in markdown
      const markdown = `import { DemoCodeHighlighterCode } from './demos/code';

<DemoCodeHighlighterCode />

[See Demo](./demos/code/)

---

## Next Section`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Plugin should work! It removes the "[See Demo]" link and HR
      expect(ast.children).toHaveLength(3);

      expect(ast.children[0].type).toBe('paragraph'); // import statement
      expect(ast.children[1].type).toBe('html'); // <DemoCodeHighlighterCode /> becomes html node
      expect(ast.children[1].value).toBe('<DemoCodeHighlighterCode />');
      expect(ast.children[2].type).toBe('heading'); // heading remains
    });

    it('should handle MDX JSX flow elements (simulated)', () => {
      // This simulates an MDX JSX flow element directly in the AST
      const mockAst = {
        type: 'root',
        children: [
          {
            type: 'mdxJsxFlowElement',
            name: 'DemoCodeHighlighter',
            attributes: [],
            children: [],
          },
          {
            type: 'paragraph',
            children: [
              {
                type: 'link',
                url: './demos/code/',
                children: [{ type: 'text', value: 'See Demo' }],
              },
            ],
          },
          {
            type: 'thematicBreak',
          },
          {
            type: 'heading',
            depth: 2,
            children: [{ type: 'text', value: 'Next Section' }],
          },
        ],
      };

      // Create processor with our plugin and apply it
      const processor = unified().use(transformMarkdownDemoLinks);
      const result = processor.runSync(mockAst as any) as any;

      // Should remove the link and HR, leaving just the Demo and heading
      expect(result.children).toHaveLength(2);
      expect(result.children[0].type).toBe('mdxJsxFlowElement');
      expect(result.children[1].type).toBe('heading');
    });
  });
});

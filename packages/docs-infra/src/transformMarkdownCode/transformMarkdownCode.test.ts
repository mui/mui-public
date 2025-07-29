import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { describe, it, expect } from 'vitest';
import transformMarkdownCodeVariants from './index.js';

// Processor for testing AST structure
const astProcessor = unified().use(remarkParse).use(transformMarkdownCodeVariants);

// End-to-end processor for testing final HTML output
const e2eProcessor = unified()
  .use(remarkParse)
  .use(transformMarkdownCodeVariants)
  .use(remarkRehype)
  .use(rehypeStringify);

describe('transformMarkdownCodeVariants', () => {
  describe('AST Structure Tests', () => {
    it('should transform adjacent code blocks with variant attribute into grouped HTML elements', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm
pnpm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=yarn
yarn add @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Find the HTML element in the tree
      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      expect(preElement.tagName).toBe('pre');
      expect(preElement.children).toHaveLength(3);

      // Check each code element
      const [npmCode, pnpmCode, yarnCode] = preElement.children;

      expect(npmCode.type).toBe('element');
      expect(npmCode.tagName).toBe('code');
      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(npmCode.data.hProperties.className).toBe('language-bash');
      expect(npmCode.children[0].value).toBe('npm install @mui/internal-docs-infra');

      expect(pnpmCode.data.hProperties.dataVariant).toBe('pnpm');
      expect(yarnCode.data.hProperties.dataVariant).toBe('yarn');
    });

    it('should transform code blocks with variant-group and labels into grouped HTML elements', () => {
      const markdown = `
npm
\`\`\`bash variant-group=install
npm install @mui/internal-docs-infra
\`\`\`
pnpm
\`\`\`bash variant-group=install
pnpm install @mui/internal-docs-infra
\`\`\`
yarn
\`\`\`bash variant-group=install
yarn add @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Find the HTML element in the tree
      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      expect(preElement.tagName).toBe('pre');
      expect(preElement.children).toHaveLength(3);

      // Check that variants are taken from labels
      const [npmCode, pnpmCode, yarnCode] = preElement.children;
      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(pnpmCode.data.hProperties.dataVariant).toBe('pnpm');
      expect(yarnCode.data.hProperties.dataVariant).toBe('yarn');
    });

    it('should include additional properties as data attributes', () => {
      const markdown = `
\`\`\`bash variant=npm filename=package.json
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm filename=package.json
pnpm install @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      const [npmCode, pnpmCode] = preElement.children;

      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(npmCode.data.hProperties.dataFilename).toBe('package.json');
      expect(pnpmCode.data.hProperties.dataFilename).toBe('package.json');
    });

    it('should not group code blocks without variant metadata', () => {
      const markdown = `
\`\`\`bash
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash
pnpm install @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should still have original code blocks, not HTML elements
      const codeBlocks = ast.children.filter((child: any) => child.type === 'code');
      expect(codeBlocks).toHaveLength(2);

      const preElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );
      expect(preElements).toHaveLength(0);
    });

    it('should not group single code block with variant', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should still have original code block, not HTML element
      const codeBlocks = ast.children.filter((child: any) => child.type === 'code');
      expect(codeBlocks).toHaveLength(1);

      const preElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );
      expect(preElements).toHaveLength(0);
    });

    it('should only group adjacent code blocks with variants', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`

Some text in between

\`\`\`bash variant=pnpm
pnpm install @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should still have original code blocks due to text separation
      const codeBlocks = ast.children.filter((child: any) => child.type === 'code');
      expect(codeBlocks).toHaveLength(2);

      const preElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );
      expect(preElements).toHaveLength(0);
    });

    it('should work with different languages', () => {
      const markdown = `
\`\`\`javascript variant=es6
const greeting = 'Hello';
\`\`\`
\`\`\`javascript variant=commonjs
const greeting = require('./greeting');
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      const [es6Code, cjsCode] = preElement.children;

      expect(es6Code.data.hProperties.className).toBe('language-javascript');
      expect(es6Code.data.hProperties.dataVariant).toBe('es6');
      expect(cjsCode.data.hProperties.dataVariant).toBe('commonjs');
    });

    it('should handle code blocks without language', () => {
      const markdown = `
\`\`\` variant=option1
Some plain text content
\`\`\`

\`\`\` variant=option2
More plain text content
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      const [option1Code, option2Code] = preElement.children;

      expect(option1Code.data.hProperties.dataVariant).toBe('option1');
      expect(option2Code.data.hProperties.dataVariant).toBe('option2');

      // Should not have className since no language specified
      expect(option1Code.data.hProperties.className).toBeUndefined();
    });

    it('should handle code blocks with blank lines between them', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`

\`\`\`bash variant=pnpm
pnpm install @mui/internal-docs-infra
\`\`\`

\`\`\`bash variant=yarn
yarn add @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      const preElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'pre',
      );

      expect(preElement).toBeDefined();
      expect(preElement.children).toHaveLength(3);

      const [npmCode, pnpmCode, yarnCode] = preElement.children;
      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(pnpmCode.data.hProperties.dataVariant).toBe('pnpm');
      expect(yarnCode.data.hProperties.dataVariant).toBe('yarn');
    });
  });

  describe('End-to-End HTML Output Tests', () => {
    it('should produce correct HTML for adjacent code blocks with variants', () => {
      const markdown = `\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm
pnpm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=yarn
yarn add @mui/internal-docs-infra
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code data-variant="npm" class="language-bash">npm install @mui/internal-docs-infra</code><code data-variant="pnpm" class="language-bash">pnpm install @mui/internal-docs-infra</code><code data-variant="yarn" class="language-bash">yarn add @mui/internal-docs-infra</code></pre>',
      );
    });

    it('should produce correct HTML for variant-group with labels', () => {
      const markdown = `npm
\`\`\`bash variant-group=install
npm install @mui/internal-docs-infra
\`\`\`
pnpm
\`\`\`bash variant-group=install
pnpm install @mui/internal-docs-infra
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code data-variant="npm" class="language-bash">npm install @mui/internal-docs-infra</code><code data-variant="pnpm" class="language-bash">pnpm install @mui/internal-docs-infra</code></pre>',
      );
    });

    it('should handle HTML escaping correctly', () => {
      const markdown = `\`\`\`javascript variant=option1
const html = '<div>Hello & goodbye</div>';
\`\`\`
\`\`\`javascript variant=option2
const html = '<span>Test & more</span>';
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code data-variant="option1" class="language-javascript">const html = \'&#x3C;div>Hello &#x26; goodbye&#x3C;/div>\';</code><code data-variant="option2" class="language-javascript">const html = \'&#x3C;span>Test &#x26; more&#x3C;/span>\';</code></pre>',
      );
    });

    it('should include additional properties as data attributes in HTML', () => {
      const markdown = `\`\`\`bash variant=npm filename=package.json title="NPM Install"
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm filename=package.json title="PNPM Install"
pnpm install @mui/internal-docs-infra
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      // Now that we've fixed the quoted string parsing, the full title should be preserved
      expect(result).toEqual(
        '<pre><code data-variant="npm" class="language-bash" data-filename="package.json" data-title="NPM Install">npm install @mui/internal-docs-infra</code><code data-variant="pnpm" class="language-bash" data-filename="package.json" data-title="PNPM Install">pnpm install @mui/internal-docs-infra</code></pre>',
      );
    });

    it('should transform individual code blocks with options in language field', () => {
      const markdown = `
\`\`\`ts transform
console.log('test' as const)
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code class="language-ts" data-transform="true">console.log(\'test\' as const)</code></pre>',
      );
    });

    it('should transform individual code blocks with multiple options', () => {
      const markdown = `
\`\`\`javascript transform highlight=2-3
function test() {
  console.log('line 2');
  console.log('line 3');
}
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code class="language-javascript" data-highlight="2-3" data-transform="true">function test() {\nconsole.log(\'line 2\');\nconsole.log(\'line 3\');\n}</code></pre>',
      );
    });

    it('should transform individual code blocks with kebab-case options to camelCase', () => {
      const markdown = `
\`\`\`typescript some-option=value another-flag
const test = 'hello';
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toEqual(
        '<pre><code class="language-typescript" data-some-option="value" data-another-flag="true">const test = \'hello\';</code></pre>',
      );
    });

    it('should not duplicate variants when processing multiple groups', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm
pnpm install @mui/internal-docs-infra
\`\`\`

Some text in between

\`\`\`javascript variant=es6
const test = 'hello';
\`\`\`
\`\`\`javascript variant=commonjs
const test = require('hello');
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      // Should have exactly two pre elements, not four
      const preCount = (result.match(/<pre>/g) || []).length;
      expect(preCount).toBe(2);

      // Should not have any duplicate code elements
      expect(result).toMatch(
        /<pre><code data-variant="npm".*?>npm install @mui\/internal-docs-infra<\/code><code data-variant="pnpm".*?>pnpm install @mui\/internal-docs-infra<\/code><\/pre>/,
      );
      expect(result).toMatch(
        /<pre><code data-variant="es6".*?>const test = 'hello';<\/code><code data-variant="commonjs".*?>const test = require\('hello'\);<\/code><\/pre>/,
      );
    });
  });
});

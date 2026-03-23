import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { describe, it, expect } from 'vitest';
import transformMarkdownCodeVariants from '.';

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

      // Find the section element in the tree
      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      expect(sectionElement.tagName).toBe('section');
      expect(sectionElement.children).toHaveLength(3); // 3 figure elements

      // Check each figure element
      const [npmFigure, pnpmFigure, yarnFigure] = sectionElement.children;

      expect(npmFigure.type).toBe('element');
      expect(npmFigure.tagName).toBe('figure');
      expect(npmFigure.children[0].tagName).toBe('figcaption');
      expect(npmFigure.children[0].children[0].value).toBe('npm variant');

      // Check dl structure
      const npmDl = npmFigure.children[1];
      expect(npmDl.tagName).toBe('dl');

      // No dt when no explicit filename - language is in className
      expect(npmDl.children[0].tagName).toBe('dd');

      // Check dd/pre/code structure
      const npmCode = npmDl.children[0].children[0].children[0];
      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(npmCode.data.hProperties.className).toBe('language-shell'); // bash is normalized to shell
      expect(npmCode.children[0].value).toBe('npm install @mui/internal-docs-infra');

      // Check other figures have correct variant data (no dt, so children[1] -> children[0])
      const pnpmCode = pnpmFigure.children[1].children[0].children[0].children[0];
      const yarnCode = yarnFigure.children[1].children[0].children[0].children[0];
      expect(pnpmCode.data.hProperties.dataVariant).toBe('pnpm');
      expect(yarnCode.data.hProperties.dataVariant).toBe('yarn');
    });

    it('should transform code blocks with variant-type and labels into grouped HTML elements', () => {
      const markdown = `
npm
\`\`\`bash variant-type=install
npm install @mui/internal-docs-infra
\`\`\`
pnpm
\`\`\`bash variant-type=install
pnpm install @mui/internal-docs-infra
\`\`\`
yarn
\`\`\`bash variant-type=install
yarn add @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Find the section element in the tree
      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      expect(sectionElement.tagName).toBe('section');
      expect(sectionElement.children).toHaveLength(3);

      // Check that variants are taken from labels (no dt, so children[0] is dd)
      const [npmFigure, pnpmFigure, yarnFigure] = sectionElement.children;
      const npmCode = npmFigure.children[1].children[0].children[0].children[0];
      const pnpmCode = pnpmFigure.children[1].children[0].children[0].children[0];
      const yarnCode = yarnFigure.children[1].children[0].children[0].children[0];

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

      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      const [npmFigure, pnpmFigure] = sectionElement.children;

      // Check filename appears in dt
      expect(npmFigure.children[1].children[0].children[0].children[0].value).toBe('package.json');
      expect(pnpmFigure.children[1].children[0].children[0].children[0].value).toBe('package.json');

      const npmCode = npmFigure.children[1].children[1].children[0].children[0];
      const pnpmCode = pnpmFigure.children[1].children[1].children[0].children[0];

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

      const sectionElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );
      expect(sectionElements).toHaveLength(0);
    });

    it('should not group single code block with variant', () => {
      const markdown = `
\`\`\`bash variant=npm
npm install @mui/internal-docs-infra
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // Should create a dl element for single variant
      const dlElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'dl',
      );
      expect(dlElements).toHaveLength(1);

      // Should not have section elements
      const sectionElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );
      expect(sectionElements).toHaveLength(0);
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

      // Should have two separate dl elements due to text separation
      const dlElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'dl',
      );
      expect(dlElements).toHaveLength(2);

      const sectionElements = ast.children.filter(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );
      expect(sectionElements).toHaveLength(0);
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

      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      const [es6Figure, cjsFigure] = sectionElement.children;

      // No dt when no explicit filename, so children[0] is dd
      const es6Code = es6Figure.children[1].children[0].children[0].children[0];
      const cjsCode = cjsFigure.children[1].children[0].children[0].children[0];

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

      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      const [option1Figure, option2Figure] = sectionElement.children;

      const option1Code = option1Figure.children[1].children[0].children[0].children[0]; // No dt when no filename
      const option2Code = option2Figure.children[1].children[0].children[0].children[0];

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

      const sectionElement = ast.children.find(
        (child: any) => child.type === 'element' && child.tagName === 'section',
      );

      expect(sectionElement).toBeDefined();
      expect(sectionElement.children).toHaveLength(3);

      const [npmFigure, pnpmFigure, yarnFigure] = sectionElement.children;
      // No dt when no explicit filename, so children[0] is dd
      const npmCode = npmFigure.children[1].children[0].children[0].children[0];
      const pnpmCode = pnpmFigure.children[1].children[0].children[0].children[0];
      const yarnCode = yarnFigure.children[1].children[0].children[0].children[0];

      expect(npmCode.data.hProperties.dataVariant).toBe('npm');
      expect(pnpmCode.data.hProperties.dataVariant).toBe('pnpm');
      expect(yarnCode.data.hProperties.dataVariant).toBe('yarn');
    });

    it('should handle individual code blocks with options', () => {
      const markdown = `
\`\`\`ts transform
console.log('test' as const)
\`\`\`
`;

      const ast = astProcessor.runSync(astProcessor.parse(markdown)) as any;

      // When there's no filename, the original MDAST code node is kept
      // with data.hProperties added for the options
      const codeNode = ast.children.find((child: any) => child.type === 'code');

      expect(codeNode).toBeDefined();
      expect(codeNode.type).toBe('code');

      // Check that hProperties were added to the code node
      expect(codeNode.data.hProperties.className).toBe('language-typescript'); // ts is normalized to typescript
      expect(codeNode.data.hProperties.dataTransform).toBe('true');
      expect(codeNode.value).toBe("console.log('test' as const)");
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

      expect(result).toMatch(/<section>/);
      expect(result).toMatch(/<figure>/);
      expect(result).toMatch(/<figcaption>npm variant<\/figcaption>/);
      expect(result).toMatch(/<figcaption>pnpm variant<\/figcaption>/);
      expect(result).toMatch(/<figcaption>yarn variant<\/figcaption>/);
      expect(result).toMatch(/<dl>/);
      // No dt when no explicit filename - language is in class="language-*"
      expect(result).not.toMatch(/<dt><code>index\.sh<\/code><\/dt>/);
      expect(result).toMatch(/class="language-shell"/);
      expect(result).toMatch(/data-variant="npm"/);
      expect(result).toMatch(/data-variant="pnpm"/);
      expect(result).toMatch(/data-variant="yarn"/);
    });

    it('should produce correct HTML for variant-type with labels', () => {
      const markdown = `npm
\`\`\`bash variant-type=install
npm install @mui/internal-docs-infra
\`\`\`
pnpm
\`\`\`bash variant-type=install
pnpm install @mui/internal-docs-infra
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toMatch(/<section>/);
      expect(result).toMatch(/<figure>/);
      expect(result).toMatch(/<figcaption>npm variant<\/figcaption>/);
      expect(result).toMatch(/<figcaption>pnpm variant<\/figcaption>/);
      expect(result).toMatch(/data-variant="npm"/);
      expect(result).toMatch(/data-variant="pnpm"/);
    });

    it('should handle HTML escaping correctly', () => {
      const markdown = `\`\`\`javascript variant=option1
const html = '<div>Hello & goodbye</div>';
\`\`\`
\`\`\`javascript variant=option2
const html = '<span>Test & more</span>';
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toMatch(/&#x3C;div>Hello &#x26; goodbye&#x3C;\/div>/);
      expect(result).toMatch(/&#x3C;span>Test &#x26; more&#x3C;\/span>/);
      expect(result).toMatch(/data-variant="option1"/);
      expect(result).toMatch(/data-variant="option2"/);
    });

    it('should include additional properties as data attributes in HTML', () => {
      const markdown = `\`\`\`bash variant=npm filename=package.json title="NPM Install"
npm install @mui/internal-docs-infra
\`\`\`
\`\`\`bash variant=pnpm filename=package.json title="PNPM Install"
pnpm install @mui/internal-docs-infra
\`\`\``;

      const result = e2eProcessor.processSync(markdown).toString();

      expect(result).toMatch(/<dt><code>package\.json<\/code><\/dt>/);
      expect(result).toMatch(/data-filename="package\.json"/);
      expect(result).toMatch(/data-title="NPM Install"/);
      expect(result).toMatch(/data-title="PNPM Install"/);
    });

    it('should transform individual code blocks with options in language field', () => {
      const markdown = `
\`\`\`ts transform
console.log('test' as const)
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      // No dl wrapper when no explicit filename - just pre > code
      expect(result).not.toMatch(/<dl>/);
      expect(result).not.toMatch(/<dd>/);
      // class="language-*" should be normalized (ts -> typescript)
      expect(result).toMatch(/<pre><code class="language-typescript" data-transform="true">/);
      expect(result).toMatch(/console\.log\('test' as const\)/);
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

      // No dl wrapper when no explicit filename - just pre > code
      expect(result).not.toMatch(/<dl>/);
      expect(result).not.toMatch(/<dd>/);
      expect(result).toMatch(/class="language-javascript"/);
      expect(result).toMatch(/data-highlight="2-3"/);
      expect(result).toMatch(/data-transform="true"/);
    });

    it('should transform individual code blocks with kebab-case options to camelCase', () => {
      const markdown = `
\`\`\`typescript some-option=value another-flag
const test = 'hello';
\`\`\`
`;

      const result = e2eProcessor.processSync(markdown).toString();

      // No dl wrapper when no explicit filename - just pre > code
      expect(result).not.toMatch(/<dl>/);
      expect(result).toMatch(/data-some-option="value"/);
      expect(result).toMatch(/data-another-flag="true"/);
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

      // Should have exactly two section elements
      const sectionCount = (result.match(/<section>/g) || []).length;
      expect(sectionCount).toBe(2);

      // Each section should have the right variants
      expect(result).toMatch(/data-variant="npm"/);
      expect(result).toMatch(/data-variant="pnpm"/);
      expect(result).toMatch(/data-variant="es6"/);
      expect(result).toMatch(/data-variant="commonjs"/);
    });
  });

  describe('Inline Code Language Hints', () => {
    // Processor with tsx default (the library default)
    // e2eProcessor already uses the default, which is 'tsx'

    // Processor with default disabled
    const processorNoDefault = unified()
      .use(remarkParse)
      .use(transformMarkdownCodeVariants, { defaultInlineCodeLanguage: false })
      .use(remarkRehype)
      .use(rehypeStringify);

    // Processor with custom default
    const processorCustomDefault = unified()
      .use(remarkParse)
      .use(transformMarkdownCodeVariants, { defaultInlineCodeLanguage: 'ts' })
      .use(remarkRehype)
      .use(rehypeStringify);

    describe('language suffix parsing', () => {
      it('should parse language suffix from inline code', () => {
        const markdown = 'This is `<Component />{:jsx}` inline code';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-jsx"');
        // Note: < is encoded as &#x3C; by rehype-stringify
        expect(result).toContain('&#x3C;Component />');
        expect(result).not.toContain('{:jsx}');
      });

      it('should handle TypeScript suffix', () => {
        const markdown = 'Use `const x: number = 1{:ts}` for types';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-ts"');
        expect(result).toContain('const x: number = 1');
        expect(result).not.toContain('{:ts}');
      });

      it('should handle CSS suffix', () => {
        const markdown = 'Style with `.class { color: red }{:css}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-css"');
        expect(result).toContain('.class { color: red }');
      });

      it('should handle shell/bash suffix', () => {
        const markdown = 'Run `npm install{:sh}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-sh"');
        expect(result).toContain('npm install');
      });

      it('should handle code containing curly braces not at the end', () => {
        const markdown = 'Use `{ key: value }{:js}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-js"');
        expect(result).toContain('{ key: value }');
      });
    });

    describe('default language (tsx)', () => {
      it('should apply tsx by default to inline code without suffix', () => {
        const markdown = 'Use `<Component />` for rendering';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-tsx"');
        // Note: < is encoded as &#x3C; by rehype-stringify
        expect(result).toContain('&#x3C;Component />');
      });

      it('should allow explicit suffix to override default tsx', () => {
        const markdown = 'Use `<Component />{:jsx}` for rendering';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-jsx"');
        expect(result).not.toContain('class="language-tsx"');
      });

      it('should apply tsx default to all inline code in document', () => {
        const markdown = 'Both `code1` and `code2` get highlighted';
        const result = e2eProcessor.processSync(markdown).toString();

        // Both should have the language class
        const matches = result.match(/class="language-tsx"/g);
        expect(matches).toHaveLength(2);
      });

      it('should allow custom default language', () => {
        const markdown = 'Use `const x = 1` for code';
        const result = processorCustomDefault.processSync(markdown).toString();

        expect(result).toContain('class="language-ts"');
        expect(result).not.toContain('class="language-tsx"');
      });
    });

    describe('disabling default language', () => {
      it('should not highlight inline code when defaultInlineCodeLanguage is false', () => {
        const markdown = 'This is `plain code` without highlighting';
        const result = processorNoDefault.processSync(markdown).toString();

        expect(result).toContain('<code>plain code</code>');
        expect(result).not.toContain('class="language-');
      });

      it('should still parse explicit suffixes when default is disabled', () => {
        const markdown = 'Use `Component{:jsx}` with `styles{:css}` and plain `text`';
        const result = processorNoDefault.processSync(markdown).toString();

        expect(result).toContain('class="language-jsx"');
        expect(result).toContain('class="language-css"');
        expect(result).toContain('<code>text</code>');
        expect(result).not.toContain('class="language-tsx"');
      });

      it('should preserve code with curly braces that is not a language suffix', () => {
        const markdown = 'Use `{ key: value }` for objects';
        const result = processorNoDefault.processSync(markdown).toString();

        expect(result).not.toContain('class="language-');
        expect(result).toContain('{ key: value }');
      });
    });

    describe('edge cases', () => {
      it('should handle empty language suffix gracefully', () => {
        // {:} is not a valid suffix, should be preserved but still get tsx default
        const markdown = 'Test `code{:}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('code{:}');
        expect(result).toContain('class="language-tsx"');
      });

      it('should handle multiline inline code (rare but valid)', () => {
        const markdown = '`line1\nline2{:js}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-js"');
        expect(result).toContain('line1');
        expect(result).toContain('line2');
      });

      it('should handle special characters in code', () => {
        const markdown = 'Use `<Comp prop="value" />{:jsx}`';
        const result = e2eProcessor.processSync(markdown).toString();

        expect(result).toContain('class="language-jsx"');
      });

      it('should not affect fenced code blocks', () => {
        const markdown = '```js\nconst x = 1{:ts}\n```';
        const result = e2eProcessor.processSync(markdown).toString();

        // The {:ts} should be preserved in fenced code blocks
        expect(result).toContain('{:ts}');
      });
    });
  });
});

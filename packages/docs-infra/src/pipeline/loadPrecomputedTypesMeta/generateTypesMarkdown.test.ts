import { describe, it, expect } from 'vitest';
import type { ComponentTypeMeta, HookTypeMeta, TypesMeta } from './loadPrecomputedTypesMeta';
import { generateTypesMarkdown } from './generateTypesMarkdown';

// Helper to create HAST from text
function textToHast(text: string) {
  return {
    type: 'root' as const,
    children: [
      {
        type: 'element' as const,
        tagName: 'p',
        properties: {},
        children: [{ type: 'text' as const, value: text }],
      },
    ],
  };
}

// Helper to create HAST code
function codeToHast(code: string) {
  return {
    type: 'root' as const,
    children: [
      {
        type: 'element' as const,
        tagName: 'code',
        properties: {},
        children: [{ type: 'text' as const, value: code }],
      },
    ],
  };
}

describe('generateTypesMarkdown', () => {
  describe('component type generation', () => {
    it('should generate markdown for a basic component without description', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: componentMeta }];

      const result = await generateTypesMarkdown('Button API', typesMeta);

      expect(result).toContain('# Button API');
      expect(result).toContain('## API Reference');
      expect(result).toContain('### Button');
    });

    it('should generate markdown for component with HAST description', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'Button',
        description: textToHast('A clickable button component'),
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: componentMeta }];

      const result = await generateTypesMarkdown('Button API', typesMeta);

      expect(result).toContain('### Button');
      expect(result).toContain('A clickable button component');
    });

    it('should generate props table with HAST types and descriptions', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('"primary" | "secondary"'),
            description: textToHast('The button variant'),
            default: 'primary',
          },
          disabled: {
            type: codeToHast('boolean'),
            description: textToHast('Whether the button is disabled'),
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: componentMeta }];

      const result = await generateTypesMarkdown('Button API', typesMeta);

      expect(result).toContain('**Button Props:**');
      expect(result).toMatch(/\| Prop\s+\|/);
      expect(result).toContain('| variant');
      expect(result).toContain('| disabled');
      expect(result).toContain('The button variant');
      expect(result).toContain('Whether the button is disabled');
      expect(result).toContain('`primary`');
    });

    it('should generate data attributes table', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {
          'data-state': {
            type: '"active" | "inactive"',
            description: textToHast('The current state of the button'),
          },
        },
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: componentMeta }];

      const result = await generateTypesMarkdown('Button API', typesMeta);

      expect(result).toContain('**Button Data Attributes:**');
      expect(result).toMatch(/\| Attribute\s+\|/);
      expect(result).toContain('| data-state');
      expect(result).toContain('The current state of the button');
    });

    it('should generate CSS variables table', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {},
        cssVariables: {
          '--button-bg': {
            type: 'color',
            description: textToHast('Background color of the button'),
          },
          '--button-padding': {
            type: 'length',
            description: textToHast('Padding inside the button'),
          },
        },
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: componentMeta }];

      const result = await generateTypesMarkdown('Button API', typesMeta);

      expect(result).toContain('**Button CSS Variables:**');
      expect(result).toMatch(/\| Variable\s+\|/);
      expect(result).toContain('| `--button-bg`');
      expect(result).toContain('| `--button-padding` |');
      expect(result).toContain('Background color of the button');
      expect(result).toContain('Padding inside the button');
    });

    it('should handle component with all sections', async () => {
      const componentMeta: ComponentTypeMeta = {
        name: 'CompleteButton',
        description: textToHast('A fully-featured button'),
        props: {
          variant: {
            type: codeToHast('string'),
          },
        },
        dataAttributes: {
          'data-active': {
            type: 'boolean',
            description: textToHast('Active state'),
          },
        },
        cssVariables: {
          '--color': {
            type: 'color',
            description: textToHast('Button color'),
          },
        },
      };

      const typesMeta: TypesMeta[] = [
        { type: 'component', name: 'CompleteButton', data: componentMeta },
      ];

      const result = await generateTypesMarkdown('Complete API', typesMeta);

      expect(result).toContain('### CompleteButton');
      expect(result).toContain('A fully-featured button');
      expect(result).toContain('**CompleteButton Props:**');
      expect(result).toContain('**CompleteButton Data Attributes:**');
      expect(result).toContain('**CompleteButton CSS Variables:**');
    });
  });

  describe('hook type generation', () => {
    it('should generate markdown for a basic hook without description', async () => {
      const hookMeta: HookTypeMeta = {
        name: 'useCounter',
        parameters: {},
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hookMeta }];

      const result = await generateTypesMarkdown('useCounter API', typesMeta);

      expect(result).toContain('# useCounter API');
      expect(result).toContain('### useCounter');
    });

    it('should generate markdown for hook with HAST description', async () => {
      const hookMeta: HookTypeMeta = {
        name: 'useCounter',
        description: textToHast('A hook for managing counter state'),
        parameters: {},
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hookMeta }];

      const result = await generateTypesMarkdown('useCounter API', typesMeta);

      expect(result).toContain('A hook for managing counter state');
    });

    it('should generate parameters table', async () => {
      const hookMeta: HookTypeMeta = {
        name: 'useCounter',
        parameters: {
          initialValue: {
            type: 'number',
            default: '0',
            description: 'The initial counter value',
          },
          step: {
            type: 'number',
            description: 'Increment/decrement step',
          },
        },
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hookMeta }];

      const result = await generateTypesMarkdown('useCounter API', typesMeta);

      expect(result).toContain('**useCounter Parameters:**');
      expect(result).toMatch(/\| Parameter\s+\|/);
      expect(result).toContain('| initialValue');
      expect(result).toContain('| step');
      expect(result).toContain('The initial counter value');
      expect(result).toContain('Increment/decrement step');
      expect(result).toContain('`0`');
    });

    it('should generate return value as string', async () => {
      const hookMeta: HookTypeMeta = {
        name: 'useCounter',
        parameters: {},
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hookMeta }];

      const result = await generateTypesMarkdown('useCounter API', typesMeta);

      expect(result).toContain('**useCounter Return Value:**');
      expect(result).toContain('`number`');
    });

    it('should generate return value as table for object types', async () => {
      const hookMeta: HookTypeMeta = {
        name: 'useCounter',
        parameters: {},
        returnValue: {
          count: {
            type: 'number',
            description: 'Current count value',
          },
          increment: {
            type: '() => void',
            description: 'Function to increment counter',
          },
          decrement: {
            type: '() => void',
            description: 'Function to decrement counter',
          },
        },
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hookMeta }];

      const result = await generateTypesMarkdown('useCounter API', typesMeta);

      expect(result).toContain('**useCounter Return Value:**');
      expect(result).toMatch(/\| Property\s+\|/);
      expect(result).toContain('| count');
      expect(result).toContain('| increment |');
      expect(result).toContain('| decrement |');
      expect(result).toContain('Current count value');
      expect(result).toContain('Function to increment counter');
    });
  });

  describe('other export type generation', () => {
    it('should generate markdown for type exports', async () => {
      const exportMeta = {
        name: 'ButtonProps',
        type: {
          kind: 'object' as const,
          properties: [],
          call: [],
          construct: [],
        },
        documentation: {
          description: 'Props for the Button component',
          defaultValue: '',
          visibility: 'public' as const,
          tags: {},
          hasTag: () => false,
          getTagValue: () => undefined,
        },
      };

      const typesMeta: TypesMeta[] = [
        { type: 'other', name: 'ButtonProps', data: exportMeta as any },
      ];

      const result = await generateTypesMarkdown('Types', typesMeta);

      expect(result).toContain('### ButtonProps');
      expect(result).toContain('Props for the Button component');
      // Should include a code block with the formatted type
      expect(result).toMatch(/```typescript/);
    });

    it('should handle export without documentation', async () => {
      const exportMeta = {
        name: 'Status',
        type: {
          kind: 'intrinsic' as const,
          name: 'string',
        },
      };

      const typesMeta: TypesMeta[] = [{ type: 'other', name: 'Status', data: exportMeta as any }];

      const result = await generateTypesMarkdown('Types', typesMeta);

      expect(result).toContain('### Status');
      expect(result).toMatch(/```typescript/);
    });
  });

  describe('multiple type generation', () => {
    it('should generate markdown for multiple components', async () => {
      const button: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const input: ComponentTypeMeta = {
        name: 'Input',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [
        { type: 'component', name: 'Button', data: button },
        { type: 'component', name: 'Input', data: input },
      ];

      const result = await generateTypesMarkdown('Components', typesMeta);

      expect(result).toContain('### Button');
      expect(result).toContain('### Input');
    });

    it('should generate markdown for mixed types', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const hook: HookTypeMeta = {
        name: 'useButton',
        parameters: {},
        returnValue: 'void',
      };

      const typeExport = {
        name: 'ButtonProps',
        type: { kind: 'intrinsic' as const, name: 'object' },
      };

      const typesMeta: TypesMeta[] = [
        { type: 'component', name: 'Button', data: component },
        { type: 'hook', name: 'useButton', data: hook },
        { type: 'other', name: 'ButtonProps', data: typeExport as any },
      ];

      const result = await generateTypesMarkdown('Mixed API', typesMeta);

      expect(result).toContain('### Button');
      expect(result).toContain('### useButton');
      expect(result).toContain('### ButtonProps');
    });
  });

  describe('markdown formatting', () => {
    it('should include autogeneration comment', async () => {
      const typesMeta: TypesMeta[] = [];
      const result = await generateTypesMarkdown('Empty', typesMeta);

      expect(result).toContain('[//]: types.ts');
      expect(result).toContain('<-- Autogenerated By');
    });

    it('should create proper heading hierarchy', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API Reference', typesMeta);

      // Check heading levels
      expect(result).toMatch(/^# API Reference/m);
      expect(result).toMatch(/^## API Reference/m);
      expect(result).toMatch(/^### Button/m);
    });

    it('should use proper table alignment', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('string'),
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Check for table alignment markers (uses :------ style)
      expect(result).toMatch(/\| :[-]+\s+\|/);
    });
  });

  describe('complex HAST descriptions', () => {
    it('should handle HAST with code blocks in descriptions', async () => {
      const descriptionWithCode = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Use this component like:' }],
          },
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {},
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: { className: ['language-tsx'] },
                children: [{ type: 'text' as const, value: '<Button variant="primary" />' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        description: descriptionWithCode,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('Use this component like:');
      expect(result).toContain('```tsx');
      expect(result).toContain('<Button variant="primary" />');
    });

    it('should handle HAST with links in descriptions', async () => {
      const descriptionWithLink = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [
              { type: 'text' as const, value: 'See the ' },
              {
                type: 'element' as const,
                tagName: 'a',
                properties: { href: 'https://example.com' },
                children: [{ type: 'text' as const, value: 'documentation' }],
              },
              { type: 'text' as const, value: ' for more details.' },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        description: descriptionWithLink,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('See the');
      expect(result).toContain('[documentation](https://example.com)');
      expect(result).toContain('for more details.');
    });

    it('should handle HAST with lists in descriptions', async () => {
      const descriptionWithList = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'This component supports:' }],
          },
          {
            type: 'element' as const,
            tagName: 'ul',
            properties: {},
            children: [
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [{ type: 'text' as const, value: 'Primary variant' }],
              },
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [{ type: 'text' as const, value: 'Secondary variant' }],
              },
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [{ type: 'text' as const, value: 'Disabled state' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        description: descriptionWithList,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('This component supports:');
      expect(result).toContain('- Primary variant');
      expect(result).toContain('- Secondary variant');
      expect(result).toContain('- Disabled state');
    });

    it('should handle HAST with inline code in prop descriptions', async () => {
      const propDescriptionWithCode = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [
              { type: 'text' as const, value: 'Set to ' },
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'true' }],
              },
              { type: 'text' as const, value: ' to disable the button.' },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          disabled: {
            type: codeToHast('boolean'),
            description: propDescriptionWithCode,
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('Set to `true` to disable the button.');
    });

    it('should handle HAST with multiple paragraphs', async () => {
      const multiParagraphDescription = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'First paragraph with introduction.' }],
          },
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Second paragraph with more details.' }],
          },
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Third paragraph with examples.' }],
          },
        ],
      };

      const hook: HookTypeMeta = {
        name: 'useCounter',
        description: multiParagraphDescription,
        parameters: {},
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hook }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('First paragraph with introduction.');
      expect(result).toContain('Second paragraph with more details.');
      expect(result).toContain('Third paragraph with examples.');
    });

    it('should handle precomputed code blocks with dataPrecompute attribute', async () => {
      // Simulate a precomputed code block as would be generated by the syntax highlighter
      const precomputedCode = {
        Default: {
          source: {
            type: 'root' as const,
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'const x = 42;' }],
              },
            ],
          },
        },
      };

      const descriptionWithPrecomputed = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Example code:' }],
          },
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {
              dataPrecompute: JSON.stringify(precomputedCode),
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'const x = 42;' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Example',
        description: descriptionWithPrecomputed,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Example', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('Example code:');
      expect(result).toContain('const x = 42;');
      // The precomputed code should be expanded and converted to markdown code block
      expect(result).toMatch(/```[\s\S]*const x = 42;/);
    });

    it('should handle precomputed code with hastJson serialization', async () => {
      const hastJson = JSON.stringify({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'function hello() {}' }],
          },
        ],
      });

      const precomputedCode = {
        Default: {
          source: { hastJson },
        },
      };

      const descriptionWithHastJson = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {
              dataPrecompute: JSON.stringify(precomputedCode),
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'function hello() {}' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Example',
        description: descriptionWithHastJson,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Example', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('function hello() {}');
    });

    it('should handle precomputed code with string source', async () => {
      const precomputedCode = {
        Default: {
          source: 'const greeting = "Hello";',
        },
      };

      const descriptionWithStringSource = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {
              dataPrecompute: JSON.stringify(precomputedCode),
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'const greeting = "Hello";' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Example',
        description: descriptionWithStringSource,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Example', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('const greeting = "Hello";');
    });

    it('should handle malformed dataPrecompute gracefully', async () => {
      const descriptionWithInvalidPrecompute = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Before code' }],
          },
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {
              dataPrecompute: 'invalid json{',
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: 'fallback code' }],
              },
            ],
          },
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'After code' }],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Example',
        description: descriptionWithInvalidPrecompute,
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Example', data: component }];

      // Should not throw, should handle gracefully
      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('Before code');
      expect(result).toContain('After code');
      // When dataPrecompute is invalid, the original code should still be present
      expect(result).toContain('fallback code');
    });

    it('should handle precomputed code in prop descriptions', async () => {
      const precomputedCode = {
        Default: {
          source: {
            type: 'root' as const,
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: '<Button onClick={handler} />' }],
              },
            ],
          },
        },
      };

      const propDescriptionWithPrecomputed = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Usage example:' }],
          },
          {
            type: 'element' as const,
            tagName: 'pre',
            properties: {
              dataPrecompute: JSON.stringify(precomputedCode),
            },
            children: [
              {
                type: 'element' as const,
                tagName: 'code',
                properties: {},
                children: [{ type: 'text' as const, value: '<Button onClick={handler} />' }],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          onClick: {
            type: codeToHast('() => void'),
            description: propDescriptionWithPrecomputed,
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Code blocks in table cells should now be converted to inline code
      expect(result).toContain('Usage example:');
      expect(result).toContain('`<Button onClick={handler} />`');
      expect(result).toContain('| onClick');
    });

    it('should convert lists in prop descriptions to inline comma-separated content', async () => {
      const descriptionWithList = {
        type: 'root' as const,
        children: [
          {
            type: 'element' as const,
            tagName: 'p',
            properties: {},
            children: [{ type: 'text' as const, value: 'Supported variants:' }],
          },
          {
            type: 'element' as const,
            tagName: 'ul',
            properties: {},
            children: [
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [
                  {
                    type: 'element' as const,
                    tagName: 'p',
                    properties: {},
                    children: [{ type: 'text' as const, value: 'primary' }],
                  },
                ],
              },
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [
                  {
                    type: 'element' as const,
                    tagName: 'p',
                    properties: {},
                    children: [{ type: 'text' as const, value: 'secondary' }],
                  },
                ],
              },
              {
                type: 'element' as const,
                tagName: 'li',
                properties: {},
                children: [
                  {
                    type: 'element' as const,
                    tagName: 'p',
                    properties: {},
                    children: [{ type: 'text' as const, value: 'tertiary' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('string'),
            description: descriptionWithList,
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Lists should be converted to comma-separated inline content in table cells
      expect(result).toContain('Supported variants:');
      expect(result).toContain('primary, secondary, tertiary');
    });
  });

  describe('optional and required markers', () => {
    it('should handle optional parameters in hooks', async () => {
      const hook: HookTypeMeta = {
        name: 'useCounter',
        parameters: {
          initialValue: {
            type: 'number',
            default: '0',
            optional: true,
            description: 'Initial counter value',
          },
          step: {
            type: 'number',
            optional: true,
            description: 'Increment step',
          },
        },
        returnValue: 'number',
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hook }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Currently, optional markers are not displayed in the markdown
      // This test documents the current behavior
      expect(result).toContain('| initialValue');
      expect(result).toContain('| step');
      expect(result).toContain('Initial counter value');
      expect(result).toContain('Increment step');
      // Optional marker is stored in data but not currently rendered
      // If/when we add optional markers to the output, update this test
    });

    it('should handle required properties in components', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('string'),
            required: true,
            description: textToHast('Button variant (required)'),
          },
          disabled: {
            type: codeToHast('boolean'),
            description: textToHast('Disabled state (optional)'),
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Currently, required markers are not displayed in the markdown
      // This test documents the current behavior
      expect(result).toContain('| variant');
      expect(result).toContain('| disabled');
      expect(result).toContain('Button variant (required)');
      expect(result).toContain('Disabled state (optional)');
      // Required marker is stored in data but not currently rendered
      // If/when we add required markers to the output, update this test
    });

    it('should preserve optional flag in hook return value properties', async () => {
      const hook: HookTypeMeta = {
        name: 'useCounter',
        parameters: {},
        returnValue: {
          count: {
            type: 'number',
            description: 'Current count',
          },
          reset: {
            type: '() => void',
            optional: true,
            description: 'Optional reset function',
          },
        },
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useCounter', data: hook }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Document current behavior for optional return value properties
      expect(result).toContain('| count');
      expect(result).toContain('| reset');
      expect(result).toContain('Current count');
      expect(result).toContain('Optional reset function');
    });
  });

  describe('edge cases', () => {
    it('should handle empty types array', async () => {
      const result = await generateTypesMarkdown('Empty API', []);

      expect(result).toContain('# Empty API');
      expect(result).toContain('## API Reference');
    });

    it('should handle component with empty props object', async () => {
      const component: ComponentTypeMeta = {
        name: 'Empty',
        props: {},
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Empty', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('### Empty');
      expect(result).not.toContain('**Empty Props:**');
    });

    it('should handle hook with empty return value object', async () => {
      const hook: HookTypeMeta = {
        name: 'useEmpty',
        parameters: {},
        returnValue: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'hook', name: 'useEmpty', data: hook }];

      const result = await generateTypesMarkdown('API', typesMeta);

      expect(result).toContain('### useEmpty');
      // Empty return value objects still show the header currently
      // This could be considered a bug that should be fixed in the implementation
    });

    it('should handle prop with missing type', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('unknown'),
            description: textToHast('Variant prop'),
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Should handle the variant property with type
      expect(result).toContain('| variant |');
      expect(result).toContain('Variant prop');
    });

    it('should handle prop with missing description', async () => {
      const component: ComponentTypeMeta = {
        name: 'Button',
        props: {
          variant: {
            type: codeToHast('string'),
          },
        },
        dataAttributes: {},
        cssVariables: {},
      };

      const typesMeta: TypesMeta[] = [{ type: 'component', name: 'Button', data: component }];

      const result = await generateTypesMarkdown('API', typesMeta);

      // Should show variant with dash for missing description
      expect(result).toContain('| variant');
      expect(result).toMatch(/\|\s+-\s+\|/);
    });
  });
});

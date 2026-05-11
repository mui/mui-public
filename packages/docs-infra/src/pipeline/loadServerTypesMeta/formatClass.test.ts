import { describe, it, expect } from 'vitest';
import { formatClassData } from './formatClass';
import type { TypeRewriteContext } from './rewriteTypes';

/** Default rewrite context for testing - empty map and empty export names */
const defaultRewriteContext: TypeRewriteContext = {
  typeCompatibilityMap: new Map(),
  exportNames: [],
};

describe('formatClass', () => {
  describe('formatClassData', () => {
    it('should apply descriptionReplacements to class description', async () => {
      const result = await formatClassData(
        {
          name: 'MyClass',
          type: {
            kind: 'class',
            constructSignatures: [],
            properties: [],
            methods: [],
          },
          documentation: {
            description: 'A useful class\n\nDocumentation: https://example.com',
          },
        } as any,
        {},
        defaultRewriteContext,
        {
          descriptionReplacements: [
            { pattern: '\\n\\nDocumentation:.*$', replacement: '', flags: 's' },
          ],
        },
      );

      expect(result.descriptionText).toBe('A useful class');
      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'A useful class' }],
          },
        ],
      });
    });

    it('should apply descriptionReplacements to property descriptions', async () => {
      const result = await formatClassData(
        {
          name: 'MyClass',
          type: {
            kind: 'class',
            constructSignatures: [],
            properties: [
              {
                name: 'value',
                type: { kind: 'intrinsic', intrinsic: 'string' },
                documentation: {
                  description: 'The value\n\nDocumentation: https://example.com',
                },
                optional: false,
                readonly: false,
                isStatic: false,
              },
            ],
            methods: [],
          },
        } as any,
        {},
        defaultRewriteContext,
        {
          descriptionReplacements: [
            { pattern: '\\n\\nDocumentation:.*$', replacement: '', flags: 's' },
          ],
        },
      );

      expect(result.properties.value.descriptionText).toBe('The value');
    });

    it('should apply descriptionReplacements to method descriptions', async () => {
      const result = await formatClassData(
        {
          name: 'MyClass',
          type: {
            kind: 'class',
            constructSignatures: [],
            properties: [],
            methods: [
              {
                name: 'doWork',
                callSignatures: [
                  {
                    parameters: [],
                    returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                  },
                ],
                documentation: {
                  description: 'Does work\n\nDocumentation: https://example.com',
                },
                isStatic: false,
              },
            ],
          },
        } as any,
        {},
        defaultRewriteContext,
        {
          descriptionReplacements: [
            { pattern: '\\n\\nDocumentation:.*$', replacement: '', flags: 's' },
          ],
        },
      );

      expect(result.methods.doWork.descriptionText).toBe('Does work');
    });
  });
});

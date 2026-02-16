import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatFunctionData, isPublicFunction } from './formatFunction';
import type { TypeRewriteContext } from './format';

/** Default rewrite context for testing - empty map and empty export names */
const defaultRewriteContext: TypeRewriteContext = {
  typeCompatibilityMap: new Map(),
  exportNames: [],
};

/**
 * Creates a mock ExportNode for testing purposes.
 * This helper centralizes the type assertion for test mocks, making it easier to maintain
 * and ensuring consistency across all mock objects in the test suite.
 *
 * Note: We cast through `unknown` as recommended for test mocks that don't implement
 * the full interface from external libraries like typescript-api-extractor.
 */
function createMockExportNode(partial: {
  name: string;
  type: { kind: string; [key: string]: unknown };
  isPublic?: () => boolean;
  documentation?: { [key: string]: unknown };
}): tae.ExportNode {
  return {
    isPublic: () => true,
    ...partial,
  } as unknown as tae.ExportNode;
}

/**
 * Creates a mock function ExportNode with FunctionNode type for testing.
 * Used specifically for tests that call formatFunctionData which requires a FunctionNode type.
 */
function createMockFunctionExportNode(partial: {
  name: string;
  type: { kind: 'function'; [key: string]: unknown };
  isPublic?: () => boolean;
  documentation?: { [key: string]: unknown };
}): tae.ExportNode & { type: tae.FunctionNode } {
  return {
    isPublic: () => true,
    ...partial,
  } as unknown as tae.ExportNode & { type: tae.FunctionNode };
}

describe('formatFunction', () => {
  describe('isPublicFunction', () => {
    it('should accept function types', () => {
      const mockExport = createMockExportNode({
        name: 'mergeProps',
        type: { kind: 'function', callSignatures: [] },
      });

      expect(isPublicFunction(mockExport)).toBe(true);
    });

    it('should reject non-FunctionNode types', () => {
      const mockExport = createMockExportNode({
        name: 'Button',
        type: { kind: 'component' },
      });

      expect(isPublicFunction(mockExport)).toBe(false);
    });

    it('should reject hooks (names starting with use)', () => {
      const mockExport = createMockExportNode({
        name: 'useButton',
        type: { kind: 'function', callSignatures: [] },
      });

      expect(isPublicFunction(mockExport)).toBe(false);
    });

    it('should reject @ignore tagged functions', () => {
      const mockExport = createMockExportNode({
        name: 'internalHelper',
        type: { kind: 'function', callSignatures: [] },
        documentation: {
          tags: [{ name: 'ignore', value: undefined }],
        },
      });

      expect(isPublicFunction(mockExport)).toBe(false);
    });

    it('should reject non-public functions', () => {
      const mockExport = createMockExportNode({
        name: 'privateHelper',
        type: { kind: 'function', callSignatures: [] },
        documentation: {
          visibility: 'internal',
          tags: [],
        },
      });

      expect(isPublicFunction(mockExport)).toBe(false);
    });
  });

  describe('formatFunctionData', () => {
    it('should format basic function metadata including name, description, and empty parameters', async () => {
      const func = createMockFunctionExportNode({
        name: 'doSomething',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
        documentation: { description: 'Does something useful' },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.name).toBe('doSomething');
      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Does something useful' }],
          },
        ],
      });
      expect(result.parameters).toEqual({});
      expect(result.returnValue).toBe('void');
    });

    it('should remove documentation URL suffix from description', async () => {
      const func = createMockFunctionExportNode({
        name: 'doSomething',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
        documentation: {
          description: 'A helper function\n\nDocumentation: https://example.com/docs',
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.descriptionText).toBe('A helper function');
    });

    it('should format function with parameters', async () => {
      const func = createMockFunctionExportNode({
        name: 'mergeProps',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'a',
                  type: {
                    kind: 'external',
                    typeName: {
                      name: 'InputProps',
                      typeArguments: [
                        {
                          type: { kind: 'intrinsic', intrinsic: 'ElementType' },
                          equalToDefault: false,
                        },
                      ],
                    },
                  },
                  optional: false,
                  documentation: { description: 'Props object to merge.' },
                },
                {
                  name: 'b',
                  type: {
                    kind: 'external',
                    typeName: {
                      name: 'InputProps',
                      typeArguments: [
                        {
                          type: { kind: 'intrinsic', intrinsic: 'ElementType' },
                          equalToDefault: false,
                        },
                      ],
                    },
                  },
                  optional: false,
                  documentation: {
                    description:
                      'Props object to merge. The function will overwrite conflicting props from `a`.',
                  },
                },
                {
                  name: 'c',
                  type: {
                    kind: 'external',
                    typeName: {
                      name: 'InputProps',
                      typeArguments: [
                        {
                          type: { kind: 'intrinsic', intrinsic: 'ElementType' },
                          equalToDefault: false,
                        },
                      ],
                    },
                  },
                  optional: true,
                  documentation: {
                    description:
                      'Props object to merge. The function will overwrite conflicting props from previous parameters.',
                  },
                },
              ],
              returnValueType: { kind: 'object', properties: [] },
            },
          ],
        },
        documentation: {
          description: 'Merges multiple props objects together.',
          tags: [{ name: 'returns', value: 'The merged props.' }],
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.name).toBe('mergeProps');
      expect(result.parameters.a).toBeDefined();
      expect(result.parameters.a.typeText).toBe('InputProps<ElementType>');
      expect(result.parameters.a.optional).toBeUndefined();
      expect(result.parameters.a.descriptionText).toBe('Props object to merge.');

      expect(result.parameters.b).toBeDefined();
      expect(result.parameters.b.typeText).toBe('InputProps<ElementType>');

      expect(result.parameters.c).toBeDefined();
      // Optional params have | undefined appended for HAST highlighting
      expect(result.parameters.c.typeText).toBe('InputProps<ElementType> | undefined');
      expect(result.parameters.c.optional).toBe(true);

      // Empty object return types are formatted as strings (not expanded to empty objects)
      expect(result.returnValue).toBe('{}');
      expect(result.returnValueDescriptionText).toBe('The merged props.');
    });

    it('should format return value type as string', async () => {
      const func = createMockFunctionExportNode({
        name: 'getValue',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
            },
          ],
        },
        documentation: {
          tags: [{ name: 'returns', value: 'The string value.' }],
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.returnValue).toBe('string');
      expect(result.returnValueDescriptionText).toBe('The string value.');
      expect(result.returnValueDescription).toBeDefined();
    });

    it('should handle function with complex return type', async () => {
      const func = createMockFunctionExportNode({
        name: 'createHandler',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: {
                kind: 'function',
                callSignatures: [
                  {
                    parameters: [
                      {
                        name: 'event',
                        type: { kind: 'external', typeName: { name: 'Event' } },
                        optional: false,
                      },
                    ],
                    returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                  },
                ],
              },
            },
          ],
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.returnValue).toBe('((event: Event) => void)');
    });

    it('should return type reference for named object type (class instance)', async () => {
      // Test case for functions like createDialogHandle() that return class instances
      // The return type is an ObjectNode with typeName and properties - should NOT expand
      const func = createMockFunctionExportNode({
        name: 'createHandle',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: {
                kind: 'object',
                typeName: {
                  name: 'DialogHandle',
                  namespaces: ['Dialog'],
                  typeArguments: [
                    {
                      type: { kind: 'typeParameter', name: 'Payload' },
                      equalToDefault: false,
                    },
                  ],
                },
                properties: [
                  {
                    name: 'store',
                    type: {
                      kind: 'external',
                      typeName: {
                        name: 'DialogStore',
                        typeArguments: [
                          {
                            type: { kind: 'typeParameter', name: 'Payload' },
                            equalToDefault: false,
                          },
                        ],
                      },
                    },
                    optional: false,
                    documentation: { description: 'Internal store holding the dialog state.' },
                  },
                ],
              },
            },
          ],
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      // Should return the type reference, not expand into properties table
      expect(result.returnValue).toBe('Dialog.DialogHandle<Payload>');
    });

    it('should handle function without @returns tag', async () => {
      const func = createMockFunctionExportNode({
        name: 'doSomething',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
        documentation: {
          description: 'Does something.',
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.returnValue).toBe('void');
      expect(result.returnValueDescription).toBeUndefined();
      expect(result.returnValueDescriptionText).toBeUndefined();
    });

    it('should format parameters with default values', async () => {
      const func = createMockFunctionExportNode({
        name: 'configure',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'options',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: true,
                  defaultValue: '{}',
                  documentation: { description: 'Configuration options.' },
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.parameters.options).toBeDefined();
      // Optional params have | undefined appended for HAST highlighting
      expect(result.parameters.options.typeText).toBe('object | undefined');
      expect(result.parameters.options.optional).toBe(true);
      expect(result.parameters.options.defaultText).toBe('{}');
    });

    it('should mark parameters as optional when they do not appear in all overloads', async () => {
      // Function with overloads: (a, b), (a, b, c), (a, b, c, d, e)
      // Parameters c, d, e should be marked as optional since they don't appear in all overloads
      const func = createMockFunctionExportNode({
        name: 'mergeProps',
        type: {
          kind: 'function',
          callSignatures: [
            {
              // 5-param overload (picked as it has most params)
              parameters: [
                {
                  name: 'a',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'b',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'c',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'd',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'e',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'object' },
            },
            {
              // 4-param overload
              parameters: [
                {
                  name: 'a',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'b',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'c',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'd',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'object' },
            },
            {
              // 3-param overload
              parameters: [
                {
                  name: 'a',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'b',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'c',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'object' },
            },
            {
              // 2-param overload (minimum)
              parameters: [
                {
                  name: 'a',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
                {
                  name: 'b',
                  type: { kind: 'intrinsic', intrinsic: 'object' },
                  optional: false,
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'object' },
            },
          ],
        },
        documentation: {
          description: 'Merges multiple props objects together.',
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      // a and b should NOT be optional (they appear in all overloads)
      expect(result.parameters.a.optional).toBeUndefined();
      expect(result.parameters.b.optional).toBeUndefined();

      // c, d, e should be optional (they don't appear in all overloads)
      expect(result.parameters.c.optional).toBe(true);
      expect(result.parameters.d.optional).toBe(true);
      expect(result.parameters.e.optional).toBe(true);
    });

    it('should format object return values with properties like hook return values', async () => {
      const func = createMockFunctionExportNode({
        name: 'createState',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'initialValue',
                  type: { kind: 'intrinsic', intrinsic: 'number' },
                  optional: false,
                },
              ],
              returnValueType: {
                kind: 'object',
                properties: [
                  {
                    name: 'value',
                    type: { kind: 'intrinsic', intrinsic: 'number' },
                    optional: false,
                    documentation: { description: 'The current value.' },
                  },
                  {
                    name: 'setValue',
                    type: {
                      kind: 'function',
                      callSignatures: [
                        {
                          parameters: [
                            {
                              name: 'newValue',
                              type: { kind: 'intrinsic', intrinsic: 'number' },
                              optional: false,
                            },
                          ],
                          returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                        },
                      ],
                    },
                    optional: false,
                    documentation: { description: 'Updates the value.' },
                  },
                ],
              },
            },
          ],
        },
        documentation: {
          description: 'Creates a stateful value.',
        },
      });

      const result = await formatFunctionData(func, {}, defaultRewriteContext);

      expect(result.name).toBe('createState');
      // Return value should be an object with properties, not a string
      expect(typeof result.returnValue).toBe('object');
      expect(result.returnValue).not.toBeInstanceOf(String);

      const returnValueProps = result.returnValue as Record<string, unknown>;
      expect(returnValueProps.value).toBeDefined();
      expect(returnValueProps.setValue).toBeDefined();

      // Check that properties have the expected structure
      const valueProp = returnValueProps.value as { typeText: string; descriptionText?: string };
      expect(valueProp.typeText).toBe('number');
      expect(valueProp.descriptionText).toBe('The current value.');

      const setValueProp = returnValueProps.setValue as {
        typeText: string;
        descriptionText?: string;
      };
      expect(setValueProp.typeText).toBe('((newValue: number) => void)');
      expect(setValueProp.descriptionText).toBe('Updates the value.');
    });
  });
});

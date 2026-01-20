import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatHookData, isPublicHook } from './formatHook';
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
 * Creates a mock hook ExportNode with FunctionNode type for testing.
 * Used specifically for tests that call formatHookData which requires a FunctionNode type.
 */
function createMockHookExportNode(partial: {
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

describe('formatHook', () => {
  describe('isPublicHook', () => {
    it('should reject non-FunctionNode types', () => {
      const mockExport = createMockExportNode({
        name: 'useButton',
        type: { kind: 'component' },
      });

      expect(isPublicHook(mockExport)).toBe(false);
    });

    it('should reject non-hook names', () => {
      // Tests the hook naming convention check (must start with 'use').
      // The type instanceof check is bypassed using a plain object mock.
      const mockExport = createMockExportNode({
        name: 'createButton',
        type: { kind: 'function', callSignatures: [] },
      });

      expect(isPublicHook(mockExport)).toBe(false);
    });

    it('should reject @ignore tagged hooks', () => {
      const mockExport = createMockExportNode({
        name: 'useInternal',
        type: { kind: 'function', callSignatures: [] },
        documentation: {
          tags: [{ name: 'ignore', value: undefined }],
        },
      });

      expect(isPublicHook(mockExport)).toBe(false);
    });

    it('should reject non-public hooks', () => {
      const mockExport = createMockExportNode({
        name: 'usePrivate',
        type: { kind: 'function', callSignatures: [] },
        documentation: {
          visibility: 'internal',
          tags: [],
        },
      });

      expect(isPublicHook(mockExport)).toBe(false);
    });
  });

  describe('formatHookData', () => {
    it('should format basic hook metadata including name, description, and empty parameters', async () => {
      const hook = createMockHookExportNode({
        name: 'useButton',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
        documentation: { description: 'A button hook' },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      expect(result.name).toBe('useButton');
      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'A button hook' }],
          },
        ],
      });
      expect(result.parameters).toEqual({});
    });

    it('should remove documentation URL suffix from description', async () => {
      const hook = createMockHookExportNode({
        name: 'useInput',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
        documentation: { description: 'Input hook\n\nDocumentation: url' },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Input hook' }],
          },
        ],
      });
    });

    it('should format hook with simple parameters', async () => {
      const hook = createMockHookExportNode({
        name: 'useCounter',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'initial',
                  type: { kind: 'intrinsic', intrinsic: 'number' },
                  optional: false,
                  documentation: { description: 'Initial value' },
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'number' },
            },
          ],
        },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      expect(result.parameters.initial).toBeDefined();
      // Parameter type is now plain text (HAST generation deferred to highlightTypesMeta)
      expect(result.parameters.initial.typeText).toBe('number');
      expect(result.parameters.initial.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Initial value' }],
          },
        ],
      });
    });

    it('should format hook with non-params object parameter', async () => {
      // Tests parameter formatting when the parameter name is not 'params'.
      // The special params object flattening logic requires instanceof ObjectNode,
      // so this validates the standard parameter formatting path instead.
      const hook = createMockHookExportNode({
        name: 'useButton',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'options',
                  type: {
                    kind: 'object',
                    properties: [
                      {
                        name: 'disabled',
                        type: { kind: 'intrinsic', intrinsic: 'boolean' },
                        optional: true,
                        documentation: { description: 'Is disabled' },
                      },
                    ],
                  },
                },
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
            },
          ],
        },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      // When the parameter name is 'options' (not 'params'), the object is not flattened
      // and instead treated as a single parameter in the output.
      expect(result.parameters.options).toBeDefined();
    });

    it('should format return value as string for simple types', async () => {
      const hook = createMockHookExportNode({
        name: 'useValue',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
            },
          ],
        },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      // returnValue is now plain string for simple types (HAST generation deferred to highlightTypesMeta)
      expect(typeof result.returnValue).toBe('string');
      expect(result.returnValue).toBe('string');
    });

    it('should format return value as object when type guard detects object type', async () => {
      // Tests that return value is correctly expanded when the type has kind: 'object'.
      // With type guards (checking kind property), plain serialized objects are correctly
      // identified as ObjectNode types and expanded into their properties structure.
      const hook = createMockHookExportNode({
        name: 'useButton',
        type: {
          kind: 'function',
          callSignatures: [
            {
              parameters: [],
              returnValueType: {
                kind: 'object',
                properties: [
                  {
                    name: 'ref',
                    type: { kind: 'intrinsic', intrinsic: 'function' },
                    optional: false,
                    documentation: { description: 'Ref callback' },
                  },
                ],
              },
            },
          ],
        },
      });

      const result = await formatHookData(hook, {}, defaultRewriteContext);

      // With type guards, the return value is correctly formatted as an object
      // with individual properties extracted from the ObjectNode structure.
      expect(typeof result.returnValue).toBe('object');
      expect(result.returnValue).toHaveProperty('ref');
    });
  });
});

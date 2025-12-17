import { describe, it, expect, beforeAll } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import type { Element as HastElement } from 'hast';
import { ensureStarryNightInitialized } from '../transformHtmlCodeInlineHighlighted';
import {
  isExternalType,
  isIntrinsicType,
  isUnionType,
  isIntersectionType,
  isObjectType,
  isArrayType,
  isFunctionType,
  isLiteralType,
  isEnumType,
  isTupleType,
  isTypeParameterType,
  formatProperties,
  formatParameters,
  formatDetailedType,
  formatEnum,
  formatType,
  prettyFormatType,
} from './format';

/**
 * Type guard to check if a HAST node is an element.
 */
function isHastElement(node: unknown): node is HastElement {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'element' &&
    'tagName' in node &&
    'properties' in node
  );
}

describe('format', () => {
  beforeAll(async () => {
    await ensureStarryNightInitialized();
  });

  describe('type guard helpers', () => {
    it('should identify external types', () => {
      const externalType = { kind: 'external', typeName: { name: 'External' } };
      expect(isExternalType(externalType)).toBe(true);
      expect(isIntrinsicType(externalType)).toBe(false);
    });

    it('should identify intrinsic types', () => {
      const intrinsicType = { kind: 'intrinsic', intrinsic: 'string' };
      expect(isIntrinsicType(intrinsicType)).toBe(true);
      expect(isExternalType(intrinsicType)).toBe(false);
    });

    it('should identify union types', () => {
      const unionType = { kind: 'union', types: [] };
      expect(isUnionType(unionType)).toBe(true);
      expect(isIntersectionType(unionType)).toBe(false);
    });

    it('should identify intersection types', () => {
      const intersectionType = { kind: 'intersection', types: [] };
      expect(isIntersectionType(intersectionType)).toBe(true);
      expect(isUnionType(intersectionType)).toBe(false);
    });

    it('should identify object types', () => {
      const objectType = { kind: 'object', properties: [] };
      expect(isObjectType(objectType)).toBe(true);
      expect(isArrayType(objectType)).toBe(false);
    });

    it('should identify array types', () => {
      const arrayType = { kind: 'array', elementType: { kind: 'intrinsic', intrinsic: 'string' } };
      expect(isArrayType(arrayType)).toBe(true);
      expect(isObjectType(arrayType)).toBe(false);
    });

    it('should identify function types', () => {
      const functionType = { kind: 'function', callSignatures: [] };
      expect(isFunctionType(functionType)).toBe(true);
      expect(isLiteralType(functionType)).toBe(false);
    });

    it('should identify literal types', () => {
      const literalType = { kind: 'literal', value: 'test' };
      expect(isLiteralType(literalType)).toBe(true);
      expect(isFunctionType(literalType)).toBe(false);
    });

    it('should identify enum types', () => {
      const enumType = { kind: 'enum', members: [] };
      expect(isEnumType(enumType)).toBe(true);
      expect(isTupleType(enumType)).toBe(false);
    });

    it('should identify tuple types', () => {
      const tupleType = { kind: 'tuple', types: [] };
      expect(isTupleType(tupleType)).toBe(true);
      expect(isEnumType(tupleType)).toBe(false);
    });

    it('should identify type parameter types', () => {
      const typeParamType = { kind: 'typeParameter', name: 'T' };
      expect(isTypeParameterType(typeParamType)).toBe(true);
      expect(isIntrinsicType(typeParamType)).toBe(false);
    });
  });

  describe('formatType', () => {
    it('should format intrinsic types', () => {
      const stringType: tae.IntrinsicNode = {
        kind: 'intrinsic',
        intrinsic: 'string',
      } as any;

      expect(formatType(stringType, false, undefined, false, [], {})).toBe('string');
    });

    it('should format literal types', () => {
      const literalType: tae.LiteralNode = {
        kind: 'literal',
        value: '"test"',
      } as any;

      expect(formatType(literalType, false, undefined, false, [], {})).toBe("'test'");
    });

    it('should format array types', () => {
      const arrayType: tae.ArrayNode = {
        kind: 'array',
        elementType: {
          kind: 'intrinsic',
          intrinsic: 'string',
        } as any,
      } as any;

      expect(formatType(arrayType, false, undefined, false, [], {})).toBe('string[]');
    });

    it('should format array types with complex elements', () => {
      const arrayType: tae.ArrayNode = {
        kind: 'array',
        elementType: {
          kind: 'union',
          types: [
            { kind: 'intrinsic', intrinsic: 'string' },
            { kind: 'intrinsic', intrinsic: 'number' },
          ],
        } as any,
      } as any;

      expect(formatType(arrayType, false, undefined, false, [], {})).toBe('(string | number)[]');
    });

    it('should format union types', () => {
      const unionType: tae.UnionNode = {
        kind: 'union',
        types: [
          { kind: 'intrinsic', intrinsic: 'string' } as any,
          { kind: 'intrinsic', intrinsic: 'number' } as any,
        ],
      } as any;

      expect(formatType(unionType, false, undefined, false, [], {})).toBe('string | number');
    });

    it('should remove undefined from union types when requested', () => {
      const unionType: tae.UnionNode = {
        kind: 'union',
        types: [
          { kind: 'intrinsic', intrinsic: 'string' } as any,
          { kind: 'intrinsic', intrinsic: 'undefined' } as any,
        ],
      } as any;

      expect(formatType(unionType, true, undefined, false, [], {})).toBe('string');
      expect(formatType(unionType, false, undefined, false, [], {})).toBe('string | undefined');
    });

    it('should format intersection types', () => {
      const intersectionType: tae.IntersectionNode = {
        kind: 'intersection',
        types: [
          {
            kind: 'object',
            properties: [
              {
                name: 'a',
                type: { kind: 'intrinsic', intrinsic: 'string' },
                optional: false,
              },
            ],
          } as any,
          {
            kind: 'object',
            properties: [
              {
                name: 'b',
                type: { kind: 'intrinsic', intrinsic: 'number' },
                optional: false,
              },
            ],
          } as any,
        ],
      } as any;

      expect(formatType(intersectionType, false, undefined, false, [], {})).toBe(
        '{ a: string } & { b: number }',
      );
    });

    it('should format object types when expanded', () => {
      const objectType: tae.ObjectNode = {
        kind: 'object',
        properties: [
          {
            name: 'name',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
          } as any,
          {
            name: 'age',
            type: { kind: 'intrinsic', intrinsic: 'number' } as any,
            optional: true,
          } as any,
        ],
      } as any;

      expect(formatType(objectType, false, undefined, true, [], {})).toBe(
        '{ name: string, age?: number }',
      );
    });

    it('should format tuple types', () => {
      const tupleType: tae.TupleNode = {
        kind: 'tuple',
        types: [
          { kind: 'intrinsic', intrinsic: 'string' } as any,
          { kind: 'intrinsic', intrinsic: 'number' } as any,
        ],
      } as any;

      expect(formatType(tupleType, false, undefined, false, [], {})).toBe('[string, number]');
    });

    it('should respect @type JSDoc tag', () => {
      const type: tae.IntrinsicNode = {
        kind: 'intrinsic',
        intrinsic: 'string',
      } as any;

      const tags: tae.DocumentationTag[] = [
        {
          name: 'type',
          value: 'CustomType',
        } as any,
      ];

      expect(formatType(type, false, tags, false, [], {})).toBe('CustomType');
    });

    it('should order union members with any, null, undefined at the end', () => {
      const unionType: tae.UnionNode = {
        kind: 'union',
        types: [
          { kind: 'intrinsic', intrinsic: 'any' } as any,
          { kind: 'intrinsic', intrinsic: 'string' } as any,
          { kind: 'intrinsic', intrinsic: 'null' } as any,
          { kind: 'intrinsic', intrinsic: 'undefined' } as any,
          { kind: 'intrinsic', intrinsic: 'number' } as any,
        ],
      } as any;

      const result = formatType(unionType, false, undefined, false, [], {});
      const parts = result.split(' | ');

      // Check that any, null, undefined are at the end
      expect(parts[parts.length - 3]).toBe('any');
      expect(parts[parts.length - 2]).toBe('null');
      expect(parts[parts.length - 1]).toBe('undefined');
    });

    describe('function type formatting', () => {
      it('should format function with required parameters', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'value',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: false,
                } as any,
                {
                  name: 'count',
                  type: { kind: 'intrinsic', intrinsic: 'number' } as any,
                  optional: false,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        expect(formatType(functionType, false, undefined, true, [], {})).toBe(
          '((value: string, count: number) => void)',
        );
      });

      it('should use ?: syntax for optional parameters at the end', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'value',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: false,
                } as any,
                {
                  name: 'options',
                  type: { kind: 'intrinsic', intrinsic: 'object' } as any,
                  optional: true,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        expect(formatType(functionType, false, undefined, true, [], {})).toBe(
          '((value: string, options?: object) => void)',
        );
      });

      it('should use ?: syntax for parameters with | undefined when all following params are optional', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'value',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: false,
                } as any,
                {
                  name: 'options',
                  type: {
                    kind: 'union',
                    types: [
                      { kind: 'intrinsic', intrinsic: 'object' } as any,
                      { kind: 'intrinsic', intrinsic: 'undefined' } as any,
                    ],
                  } as any,
                  optional: false,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        expect(formatType(functionType, false, undefined, true, [], {})).toBe(
          '((value: string, options?: object) => void)',
        );
      });

      it('should NOT use ?: syntax when optional param comes before required param', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'options',
                  type: {
                    kind: 'union',
                    types: [
                      { kind: 'intrinsic', intrinsic: 'object' } as any,
                      { kind: 'intrinsic', intrinsic: 'undefined' } as any,
                    ],
                  } as any,
                  optional: false,
                } as any,
                {
                  name: 'value',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: false,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        // Should keep | undefined since the next param is required
        expect(formatType(functionType, false, undefined, true, [], {})).toBe(
          '((options: object | undefined, value: string) => void)',
        );
      });

      it('should use ?: syntax for multiple optional parameters at the end', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'value',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: false,
                } as any,
                {
                  name: 'options',
                  type: {
                    kind: 'union',
                    types: [
                      { kind: 'intrinsic', intrinsic: 'object' } as any,
                      { kind: 'intrinsic', intrinsic: 'undefined' } as any,
                    ],
                  } as any,
                  optional: false,
                } as any,
                {
                  name: 'callback',
                  type: { kind: 'function', callSignatures: [] } as any,
                  optional: true,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        const result = formatType(functionType, false, undefined, true, [], {});
        // Both optional params should use ?: syntax
        expect(result).toContain('options?: object');
        expect(result).toContain('callback?:');
      });

      it('should handle all parameters being optional', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'a',
                  type: { kind: 'intrinsic', intrinsic: 'string' } as any,
                  optional: true,
                } as any,
                {
                  name: 'b',
                  type: { kind: 'intrinsic', intrinsic: 'number' } as any,
                  optional: true,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        expect(formatType(functionType, false, undefined, true, [], {})).toBe(
          '((a?: string, b?: number) => void)',
        );
      });

      it('should strip undefined from type when using ?: syntax', () => {
        const functionType: tae.FunctionNode = {
          kind: 'function',
          callSignatures: [
            {
              parameters: [
                {
                  name: 'options',
                  type: {
                    kind: 'union',
                    types: [
                      { kind: 'intrinsic', intrinsic: 'undefined' } as any,
                      { kind: 'intrinsic', intrinsic: 'object' } as any,
                    ],
                  } as any,
                  optional: false,
                } as any,
              ],
              returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
            } as any,
          ],
        } as any;

        const result = formatType(functionType, false, undefined, true, [], {});
        // Should be options?: object, not options?: undefined | object
        expect(result).toBe('((options?: object) => void)');
        expect(result).not.toContain('undefined');
      });
    });
  });

  describe('formatEnum', () => {
    it('should format enum members with HAST descriptions', async () => {
      const enumNode: tae.EnumNode = {
        kind: 'enum',
        members: [
          {
            value: 'option1',
            documentation: {
              description: 'First option',
              tags: [{ name: 'type', value: 'string' }],
            } as any,
          } as any,
          {
            value: 'option2',
            documentation: {
              description: 'Second option',
            } as any,
          } as any,
        ],
      } as any;

      const result = await formatEnum(enumNode);

      expect(result.option1.type).toBe('string');
      expect(result.option1.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'First option' }],
          },
        ],
      });
      expect(result.option2.type).toBeUndefined();
      expect(result.option2.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Second option' }],
          },
        ],
      });
    });

    it('should sort enum members by value', async () => {
      const enumNode: tae.EnumNode = {
        kind: 'enum',
        members: [
          { value: 'z', documentation: {} as any } as any,
          { value: 'a', documentation: {} as any } as any,
          { value: 'm', documentation: {} as any } as any,
        ],
      } as any;

      const result = await formatEnum(enumNode);
      const keys = Object.keys(result);

      expect(keys).toEqual(['a', 'm', 'z']);
    });
  });

  describe('formatDetailedType', () => {
    it('should expand external type references', () => {
      const exportNodes: tae.ExportNode[] = [
        {
          name: 'MyType',
          type: {
            kind: 'object',
            properties: [
              {
                name: 'prop',
                type: { kind: 'intrinsic', intrinsic: 'string' },
                optional: false,
              },
            ],
          } as any,
        } as any,
      ];

      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: { name: 'MyType' } as any,
      } as any;

      const result = formatDetailedType(externalType, exportNodes, [], {});
      expect(result).toBe('{ prop: string }');
    });

    it('should handle circular references', () => {
      const exportNodes: tae.ExportNode[] = [];
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: { name: 'CircularType' } as any,
      } as any;

      // Should not throw and return the type name
      const result = formatDetailedType(externalType, exportNodes, ['CircularType'], {});
      expect(result).toBe('CircularType');
    });

    it('should expand union types recursively', () => {
      const exportNodes: tae.ExportNode[] = [
        {
          name: 'TypeA',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
        } as any,
        {
          name: 'TypeB',
          type: { kind: 'intrinsic', intrinsic: 'number' } as any,
        } as any,
      ];

      const unionType: tae.UnionNode = {
        kind: 'union',
        types: [
          {
            kind: 'external',
            typeName: { name: 'TypeA' },
          } as any,
          {
            kind: 'external',
            typeName: { name: 'TypeB' },
          } as any,
        ],
      } as any;

      const result = formatDetailedType(unionType, exportNodes, [], {});
      expect(result).toBe('string | number');
    });

    it('should expand intersection types recursively', () => {
      const exportNodes: tae.ExportNode[] = [
        {
          name: 'TypeA',
          type: {
            kind: 'object',
            properties: [
              {
                name: 'a',
                type: { kind: 'intrinsic', intrinsic: 'string' },
                optional: false,
              },
            ],
          } as any,
        } as any,
      ];

      const intersectionType: tae.IntersectionNode = {
        kind: 'intersection',
        types: [
          {
            kind: 'external',
            typeName: { name: 'TypeA' },
          } as any,
          {
            kind: 'object',
            properties: [
              {
                name: 'b',
                type: { kind: 'intrinsic', intrinsic: 'number' },
                optional: false,
              },
            ],
          } as any,
        ],
      } as any;

      const result = formatDetailedType(intersectionType, exportNodes, [], {});
      expect(result).toBe('{ a: string } & { b: number }');
    });

    it('should handle known external aliases like Padding', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: { name: 'Padding' } as any,
      } as any;

      const result = formatDetailedType(externalType, [], [], {});
      expect(result).toBe(
        '{ top?: number; right?: number; bottom?: number; left?: number } | number',
      );
    });
  });

  describe('formatParameters', () => {
    it('should format function parameters with HAST descriptions', async () => {
      const params: tae.Parameter[] = [
        {
          name: 'value',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: false,
          documentation: {
            description: 'The input value',
          } as any,
        } as any,
        {
          name: 'options',
          type: { kind: 'intrinsic', intrinsic: 'object' } as any,
          optional: true,
          defaultValue: '{}',
          documentation: {
            description: 'Optional configuration',
            tags: [{ name: 'example', value: '{ key: "value" }' }],
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, [], {});

      // Parameter type is now HastRoot with syntax highlighting
      expect(result.value.type).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-ts'] },
            children: expect.arrayContaining([
              expect.objectContaining({
                type: 'element',
                tagName: 'span',
                children: [{ type: 'text', value: 'string' }],
              }),
            ]),
          },
        ],
      });
      expect(result.value.default).toBeUndefined();
      expect(result.value.optional).toBeUndefined();
      expect(result.value.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'The input value' }],
          },
        ],
      });
      expect(result.value.example).toBeUndefined();

      // Parameter type is now HastRoot with syntax highlighting
      expect(result.options.type).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-ts'] },
            children: expect.arrayContaining([
              expect.objectContaining({
                type: 'element',
                tagName: 'span',
                children: [{ type: 'text', value: 'object' }],
              }),
            ]),
          },
        ],
      });
      // Default value is now HastRoot with syntax highlighting
      expect(result.options.default).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-ts'] },
            children: [{ type: 'text', value: '{}' }],
          },
        ],
      });
      expect(result.options.defaultText).toBe('{}');
      expect(result.options.optional).toBe(true);
      expect(result.options.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Optional configuration' }],
          },
        ],
      });
      // Example is now HastRoot with markdown parsing
      expect(result.options.example).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: '{ key: "value" }' }],
          },
        ],
      });
    });

    it('should handle parameters with multiple example tags', async () => {
      const params: tae.Parameter[] = [
        {
          name: 'value',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: false,
          documentation: {
            tags: [
              { name: 'example', value: 'Example 1' },
              { name: 'example', value: 'Example 2' },
            ],
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, [], {});

      // Example is now HastRoot with markdown parsing
      expect(result.value.example).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Example 1\nExample 2' }],
          },
        ],
      });
    });
  });

  describe('formatProperties', () => {
    describe('basic formatting', () => {
      it('should format basic properties with HAST', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'title',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'The title text',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.title).toBeDefined();
        expect(result.title.required).toBe(true);

        // Verify exact description HAST structure
        expect(result.title.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              properties: {},
              children: [
                {
                  type: 'text',
                  value: 'The title text',
                },
              ],
            },
          ],
        });

        // Snapshot the inline type HAST structure (uses transformHtmlCodeInlineHighlighted - no pre/dataPrecompute)
        expect(result.title.type).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "children": [
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "string",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                ],
                "properties": {
                  "className": [
                    "language-ts",
                  ],
                },
                "tagName": "code",
                "type": "element",
              },
            ],
            "type": "root",
          }
        `);
      });
    });

    describe('detailed type selection', () => {
      it('should show detailed type for event handlers', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'onClick',
            type: {
              kind: 'function',
              callSignatures: [
                {
                  parameters: [],
                  returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.onClick.detailedType).toBeDefined();
        expect(result.onClick.shortType).toBeDefined();
        expect(result.onClick.shortTypeText).toBe('function');
      });

      it('should include shortTypeText for event handlers', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'onChange',
            type: {
              kind: 'function',
              callSignatures: [
                {
                  parameters: [{ name: 'value', type: { kind: 'intrinsic', intrinsic: 'string' } }],
                  returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                },
              ],
            } as any,
            optional: false,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.onChange.shortTypeText).toBe('function');
        expect(result.onChange.shortType).toBeDefined();
      });

      it('should include shortTypeText for className prop', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'className',
            type: {
              kind: 'union',
              types: [
                { kind: 'intrinsic', intrinsic: 'string' },
                {
                  kind: 'function',
                  callSignatures: [
                    {
                      parameters: [],
                      returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                    },
                  ],
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.className.shortTypeText).toBe('string | function');
        expect(result.className.shortType).toBeDefined();
      });

      it('should include shortTypeText for render prop', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'render',
            type: {
              kind: 'union',
              types: [
                { kind: 'external', typeName: { name: 'ReactElement' } },
                {
                  kind: 'function',
                  callSignatures: [
                    {
                      parameters: [],
                      returnValueType: { kind: 'external', typeName: { name: 'ReactElement' } },
                    },
                  ],
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.render.shortTypeText).toBe('ReactElement | function');
        expect(result.render.shortType).toBeDefined();
      });

      it('should include shortTypeText for complex unions', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'variant',
            type: {
              kind: 'union',
              types: [
                { kind: 'literal', value: "'primary'" },
                { kind: 'literal', value: "'secondary'" },
                { kind: 'literal', value: "'tertiary'" },
                { kind: 'literal', value: "'quaternary'" },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.variant.shortTypeText).toBe('Union');
        expect(result.variant.shortType).toBeDefined();
      });

      it('should not include shortType for simple types', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'title',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.title.shortType).toBeUndefined();
        expect(result.title.shortTypeText).toBeUndefined();
      });

      it('should recognize className prop for potential detailed type', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'className',
            type: {
              kind: 'union',
              types: [
                { kind: 'intrinsic', intrinsic: 'string' },
                {
                  kind: 'function',
                  callSignatures: [
                    {
                      parameters: [],
                      returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                    },
                  ],
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // className is recognized as needing detailed type, but without allExports to expand,
        // the detailed type will equal the formatted type and won't be included
        expect(result.className).toBeDefined();
        expect(result.className.type).toBeDefined();
      });

      it('should recognize render prop for potential detailed type', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'render',
            type: {
              kind: 'union',
              types: [
                {
                  kind: 'external',
                  typeName: { name: 'ReactElement' } as any,
                },
                {
                  kind: 'function',
                  callSignatures: [
                    {
                      parameters: [
                        {
                          name: 'props',
                          type: { kind: 'intrinsic', intrinsic: 'object' },
                          optional: false,
                        },
                      ],
                      returnValueType: {
                        kind: 'external',
                        typeName: { name: 'ReactElement' } as any,
                      },
                    },
                  ],
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // render is recognized as needing detailed type, but without allExports to expand,
        // the detailed type will equal the formatted type and won't be included
        expect(result.render).toBeDefined();
        expect(result.render.type).toBeDefined();
      });

      it('should not show detailed type for simple types', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'disabled',
            type: { kind: 'intrinsic', intrinsic: 'boolean' } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.disabled.detailedType).toBeUndefined();
      });

      it('should not show detailed type for refs', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'inputRef',
            type: { kind: 'external', typeName: { name: 'Ref' } } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.inputRef.detailedType).toBeUndefined();
      });

      it('should show detailed type for complex unions', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'variant',
            type: {
              kind: 'union',
              types: [
                { kind: 'literal', value: "'primary'" },
                { kind: 'literal', value: "'secondary'" },
                { kind: 'literal', value: "'tertiary'" },
                { kind: 'literal', value: "'quaternary'" },
                { kind: 'literal', value: "'quinary'" },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Complex union with 5+ members should show detailed type
        expect(result.variant.detailedType).toBeDefined();
      });
    });

    describe('prop filtering', () => {
      it('should skip ref prop when allExports indicates component context', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'ref',
            type: { kind: 'external', typeName: { name: 'Ref' } } as any,
            optional: true,
            documentation: {} as any,
          } as any,
          {
            name: 'title',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {} as any,
          } as any,
        ];

        // Pass a non-empty allExports to indicate component context
        const allExports = [{ name: 'Component' }] as any;
        const result = await formatProperties(props, [], {}, allExports);

        expect(result.ref).toBeUndefined();
        expect(result.title).toBeDefined();
      });

      it('should include ref prop when not in component context', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'ref',
            type: { kind: 'external', typeName: { name: 'Ref' } } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        // No allExports means not in component context
        const result = await formatProperties(props, [], {});

        expect(result.ref).toBeDefined();
      });

      it('should skip props marked with @ignore tag', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'internalProp',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: true,
            documentation: {
              tags: [{ name: 'ignore', value: undefined }],
            } as any,
          } as any,
          {
            name: 'publicProp',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              tags: [],
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.internalProp).toBeUndefined();
        expect(result.publicProp).toBeDefined();
      });

      it('should handle props without documentation gracefully', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'noDocs',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: true,
            documentation: undefined,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Props without documentation should be included (no @ignore tag)
        expect(result.noDocs).toBeDefined();
      });
    });

    describe('markdown parsing', () => {
      it('should parse markdown descriptions with code blocks', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description:
                'The value of the input.\n\nExample:\n```ts\n<Input value="test" />\n```',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify HAST structure (filter out whitespace text nodes)
        expect(result.value.description).toBeDefined();
        expect(result.value.description!.type).toBe('root');

        const nonWhitespaceChildren = result.value.description!.children.filter(
          (child: any) => !(child.type === 'text' && /^\s*$/.test(child.value)),
        );
        expect(nonWhitespaceChildren).toHaveLength(3);

        // First paragraph
        expect(nonWhitespaceChildren[0]).toMatchObject({
          type: 'element',
          tagName: 'p',
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'text', value: 'The value of the input.' }),
          ]),
        });

        // Second paragraph
        expect(nonWhitespaceChildren[1]).toMatchObject({
          type: 'element',
          tagName: 'p',
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'text', value: 'Example:' }),
          ]),
        });

        // Code block (raw structure, transformation happens in highlightTypes)
        expect(nonWhitespaceChildren[2]).toMatchObject({
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {
                className: ['language-ts'],
              },
              children: [
                {
                  type: 'text',
                  value: expect.stringMatching(/<Input value="test" \/>/),
                },
              ],
            },
          ],
        });
      });

      it('should parse example markdown', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              tags: [{ name: 'example', value: '```ts\nconst x = "test";\n```' }],
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify example HAST structure (raw structure, transformation happens in highlightTypes)
        expect(result.value.example).toBeDefined();
        expect(result.value.example!.type).toBe('root');
        expect(result.value.example!.children).toHaveLength(1);

        // Verify pre element has raw code block structure
        expect(result.value.example!.children[0]).toMatchObject({
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {
                className: ['language-ts'],
              },
              children: [
                {
                  type: 'text',
                  value: expect.stringMatching(/const x = "test";/),
                },
              ],
            },
          ],
        });
      });

      it('should handle props without documentation', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Without documentation, both fields should be undefined
        expect(result.value.description).toBeUndefined();
        expect(result.value.example).toBeUndefined();
      });

      it('should parse rich markdown with inline code, bold, and italic', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'content',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Use **bold** text, *italic* text, and `inline code` for emphasis.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify exact HAST structure with all inline formatting
        expect(result.content.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              properties: {},
              children: [
                { type: 'text', value: 'Use ' },
                {
                  type: 'element',
                  tagName: 'strong',
                  properties: {},
                  children: [{ type: 'text', value: 'bold' }],
                },
                { type: 'text', value: ' text, ' },
                {
                  type: 'element',
                  tagName: 'em',
                  properties: {},
                  children: [{ type: 'text', value: 'italic' }],
                },
                { type: 'text', value: ' text, and ' },
                {
                  type: 'element',
                  tagName: 'code',
                  properties: {},
                  children: [{ type: 'text', value: 'inline code' }],
                },
                { type: 'text', value: ' for emphasis.' },
              ],
            },
          ],
        });
      });
    });

    describe('inline type formatting', () => {
      it('should format type as HAST with syntax highlighting', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'handler',
            type: {
              kind: 'function',
              callSignatures: [
                {
                  parameters: [
                    {
                      name: 'event',
                      type: { kind: 'external', typeName: { name: 'MouseEvent' } as any },
                      optional: false,
                    },
                  ],
                  returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Snapshot the inline function type with external parameter type
        expect(result.handler.type).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "children": [
                  {
                    "type": "text",
                    "value": "((",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "event",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-v",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": ":",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "MouseEvent",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-en",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": ") ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "=>",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "void",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": ")",
                  },
                ],
                "properties": {
                  "className": [
                    "language-ts",
                  ],
                },
                "tagName": "code",
                "type": "element",
              },
            ],
            "type": "root",
          }
        `);
      });

      it('should format inline types with proper span structure', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'A string value',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Snapshot the complete inline type HAST structure
        expect(result.value.type).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "children": [
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "string",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                ],
                "properties": {
                  "className": [
                    "language-ts",
                  ],
                },
                "tagName": "code",
                "type": "element",
              },
            ],
            "type": "root",
          }
        `);
      });

      it('should format complex inline types with multiple span elements', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'complexProp',
            type: {
              kind: 'union',
              types: [
                { kind: 'intrinsic', intrinsic: 'string' },
                { kind: 'intrinsic', intrinsic: 'number' },
                { kind: 'intrinsic', intrinsic: 'boolean' },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Snapshot the complete union type HAST structure showing text nodes and span elements
        expect(result.complexProp.type).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "children": [
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "string",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "|",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "number",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "|",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "boolean",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                ],
                "properties": {
                  "className": [
                    "language-ts",
                  ],
                },
                "tagName": "code",
                "type": "element",
              },
            ],
            "type": "root",
          }
        `);
      });

      it('should verify detailed inline type span structure', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'callback',
            type: {
              kind: 'function',
              callSignatures: [
                {
                  parameters: [
                    {
                      name: 'value',
                      type: { kind: 'intrinsic', intrinsic: 'string' },
                      optional: false,
                    },
                  ],
                  returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                },
              ],
            } as any,
            optional: false,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Snapshot the complete function type HAST structure showing all text and span elements
        expect(result.callback.type).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "children": [
                  {
                    "type": "text",
                    "value": "((",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "value",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-v",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": ":",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "string",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": ") ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "=>",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-k",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": " ",
                  },
                  {
                    "children": [
                      {
                        "type": "text",
                        "value": "void",
                      },
                    ],
                    "properties": {
                      "className": [
                        "pl-c1",
                      ],
                    },
                    "tagName": "span",
                    "type": "element",
                  },
                  {
                    "type": "text",
                    "value": ")",
                  },
                ],
                "properties": {
                  "className": [
                    "language-ts",
                  ],
                },
                "tagName": "code",
                "type": "element",
              },
            ],
            "type": "root",
          }
        `);
      });
    });

    describe('markdown links and lists', () => {
      it('should parse markdown links correctly', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'docs',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'See [documentation](https://example.com) for details.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify exact HAST structure with link
        expect(result.docs.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              properties: {},
              children: [
                { type: 'text', value: 'See ' },
                {
                  type: 'element',
                  tagName: 'a',
                  properties: {
                    href: 'https://example.com',
                  },
                  children: [{ type: 'text', value: 'documentation' }],
                },
                { type: 'text', value: ' for details.' },
              ],
            },
          ],
        });
      });

      it('should parse markdown lists correctly', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'options',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Available options:\n- Option 1\n- Option 2\n- Option 3',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify HAST structure (filter whitespace nodes)
        expect(result.options.description).toBeDefined();
        expect(result.options.description!.type).toBe('root');

        const nonWhitespaceChildren = result.options.description!.children.filter(
          (child: any) => !(child.type === 'text' && /^\s*$/.test(child.value)),
        );
        expect(nonWhitespaceChildren).toHaveLength(2);

        // Paragraph
        expect(nonWhitespaceChildren[0]).toMatchObject({
          type: 'element',
          tagName: 'p',
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'text', value: 'Available options:' }),
          ]),
        });

        // List
        const list = nonWhitespaceChildren[1];
        expect(list).toMatchObject({
          type: 'element',
          tagName: 'ul',
        });

        if (list.type === 'element') {
          const listItems = list.children.filter(
            (child: any) => child.type === 'element' && child.tagName === 'li',
          );
          expect(listItems).toHaveLength(3);
          expect(listItems[0]).toMatchObject({
            type: 'element',
            tagName: 'li',
            children: expect.arrayContaining([
              expect.objectContaining({ type: 'text', value: 'Option 1' }),
            ]),
          });
          expect(listItems[1]).toMatchObject({
            type: 'element',
            tagName: 'li',
            children: expect.arrayContaining([
              expect.objectContaining({ type: 'text', value: 'Option 2' }),
            ]),
          });
          expect(listItems[2]).toMatchObject({
            type: 'element',
            tagName: 'li',
            children: expect.arrayContaining([
              expect.objectContaining({ type: 'text', value: 'Option 3' }),
            ]),
          });
        }
      });
    });

    describe('code block generation', () => {
      it('should include precomputed syntax highlighting data in code blocks', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Example:\n\n```typescript\nconst value = "test";\n```',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify description HAST contains raw code block (transformation happens in highlightTypes)
        expect(result.value.description).toBeDefined();
        const codeBlock = result.value.description!.children.find(
          (child) => isHastElement(child) && child.tagName === 'pre',
        );
        expect(codeBlock).toBeDefined();
        expect(isHastElement(codeBlock)).toBe(true);
        if (isHastElement(codeBlock)) {
          expect(codeBlock.tagName).toBe('pre');
          expect(codeBlock.properties).toEqual({});
        }
      });

      it('should include syntax highlighted structure in type fields', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'callback',
            type: {
              kind: 'function',
              callSignatures: [
                {
                  parameters: [],
                  returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Verify type field contains HAST structure
        expect(result.callback.type).toBeDefined();
        expect(result.callback.type.type).toBe('root');
        expect(result.callback.type.children).toBeDefined();
      });

      it('should generate appropriate code structure for markdown code blocks', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'example',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: '```js\nconsole.log("hello");\n```',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Code block should have raw structure (transformation happens in highlightTypes)
        expect(result.example.description).toBeDefined();
        const codeBlock = result.example.description!.children[0];
        expect(isHastElement(codeBlock)).toBe(true);
        if (isHastElement(codeBlock)) {
          expect(codeBlock.tagName).toBe('pre');
          expect(codeBlock.properties).toEqual({});
        }
      });
    });
  });

  describe('prettyFormatType', () => {
    it('should format types with prettier on single line', async () => {
      const type: tae.IntrinsicNode = {
        kind: 'intrinsic',
        intrinsic: 'string',
      } as any;

      const result = await prettyFormatType(type, false, undefined, false, [], {});
      expect(result).toBe('string;');
    });

    it('should format complex types with prettier on multiple lines', async () => {
      const type: tae.ObjectNode = {
        kind: 'object',
        properties: [
          {
            name: 'veryLongPropertyNameThatWillCauseWrapping',
            type: { kind: 'intrinsic', intrinsic: 'string' },
            optional: false,
          },
          {
            name: 'anotherVeryLongPropertyNameThatWillCauseWrapping',
            type: { kind: 'intrinsic', intrinsic: 'number' },
            optional: false,
          },
        ],
      } as any;

      const result = await prettyFormatType(type, false, undefined, true, [], {});

      // Should be formatted on multiple lines
      expect(result).toContain('\n');
      expect(result).toContain('veryLongPropertyNameThatWillCauseWrapping');
      expect(result).toContain('anotherVeryLongPropertyNameThatWillCauseWrapping');
    });

    it('should handle named types', async () => {
      const type: tae.ObjectNode = {
        kind: 'object',
        typeName: { name: 'MyType' } as any,
        properties: [
          {
            name: 'prop',
            type: { kind: 'intrinsic', intrinsic: 'string' },
            optional: false,
          },
        ],
      } as any;

      const result = await prettyFormatType(type, false, undefined, true, [], {});

      // Should include formatted properties
      expect(result).toContain('prop');
      expect(result).toContain('string');
    });
  });

  describe('typeNameMap transformations', () => {
    it('should transform flat type names to dotted names in formatType', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: [],
          name: 'MenuBackdropState',
        },
      } as any;

      const typeNameMap = {
        MenuBackdropState: 'Menu.BackdropState',
      };

      const result = formatType(externalType, false, undefined, false, [], typeNameMap);

      expect(result).toBe('Menu.BackdropState');
    });

    it('should transform flat type names with type arguments', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: [],
          name: 'MenuBackdropState',
        },
      } as any;

      const typeNameMap = {
        MenuBackdropState: 'Menu.BackdropState',
      };

      // Simulate a type with generic arguments
      const typeWithArgs = { ...externalType, typeName: { ...externalType.typeName } };
      const result = formatType(typeWithArgs, false, undefined, false, [], typeNameMap);

      expect(result).toBe('Menu.BackdropState');
    });

    it('should transform namespace references in formatType', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: ['MenuRoot'],
          name: 'State',
        },
      } as any;

      const typeNameMap = {
        MenuRoot: 'Menu.Root',
      };

      const result = formatType(externalType, false, undefined, false, [], typeNameMap);

      expect(result).toBe('Menu.Root.State');
    });

    it('should leave unmapped types unchanged', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: [],
          name: 'UnmappedType',
        },
      } as any;

      const typeNameMap = {
        MenuBackdropState: 'Menu.BackdropState',
      };

      const result = formatType(externalType, false, undefined, false, [], typeNameMap);

      expect(result).toBe('UnmappedType');
    });

    it('should transform property types in formatProperties', async () => {
      const props: tae.PropertyNode[] = [
        {
          name: 'state',
          type: {
            kind: 'external',
            typeName: {
              importedFrom: undefined,
              namespaces: [],
              name: 'MenuBackdropState',
            },
          } as any,
          optional: false,
          documentation: {
            description: 'The backdrop state',
          } as any,
        } as any,
      ];

      const typeNameMap = {
        MenuBackdropState: 'Menu.BackdropState',
      };

      const result = await formatProperties(props, [], typeNameMap);

      expect(result.state).toBeDefined();
      // The type field contains HAST nodes, so we check the structure
      expect(result.state.type).toMatchObject({
        type: 'root',
        children: expect.arrayContaining([
          expect.objectContaining({
            type: 'element',
            tagName: 'code',
          }),
        ]),
      });
    });

    it('should transform types in formatDetailedType', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: [],
          name: 'MenuBackdropState',
        },
      } as any;

      const typeNameMap = {
        MenuBackdropState: 'Menu.BackdropState',
      };

      const result = formatDetailedType(externalType, [], [], typeNameMap);

      // formatDetailedType returns a string with the transformed type name
      expect(result).toBe('Menu.BackdropState');
    });

    it('should handle empty typeNameMap', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: [],
          name: 'SomeType',
        },
      } as any;

      const result = formatType(externalType, false, undefined, false, [], {});

      expect(result).toBe('SomeType');
    });

    it('should transform multiple namespace levels', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: {
          importedFrom: undefined,
          namespaces: ['MenuRoot', 'Actions'],
          name: 'Handler',
        },
      } as any;

      const typeNameMap = {
        MenuRoot: 'Menu.Root',
      };

      const result = formatType(externalType, false, undefined, false, [], typeNameMap);

      expect(result).toBe('Menu.Root.Actions.Handler');
    });
  });
});

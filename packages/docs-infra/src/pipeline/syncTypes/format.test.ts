import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import type { Element as HastElement } from 'hast';
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

    it('should use typeName for named union types instead of expanding', () => {
      const unionType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'StoreAtMode' } as any,
        types: [
          { kind: 'literal', value: '"canonical"' } as any,
          { kind: 'literal', value: '"import"' } as any,
          { kind: 'literal', value: '"flat"' } as any,
        ],
      } as any;

      // Should return the type alias name, not the expanded union
      expect(formatType(unionType, false, undefined, false, [], {})).toBe('StoreAtMode');
    });

    it('should use typeName for named intersection types instead of expanding', () => {
      const intersectionType: tae.IntersectionNode = {
        kind: 'intersection',
        typeName: { name: 'CombinedProps' } as any,
        types: [
          {
            kind: 'object',
            properties: [
              { name: 'a', type: { kind: 'intrinsic', intrinsic: 'string' }, optional: false },
            ],
          } as any,
          {
            kind: 'object',
            properties: [
              { name: 'b', type: { kind: 'intrinsic', intrinsic: 'number' }, optional: false },
            ],
          } as any,
        ],
      } as any;

      // Should return the type alias name, not the expanded intersection
      expect(formatType(intersectionType, false, undefined, false, [], {})).toBe('CombinedProps');
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
        '{ a: string; b: number }',
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
        '{ name: string; age?: number }',
      );
    });

    it('should format object types with index signatures', () => {
      const objectType = {
        kind: 'object',
        properties: [],
        indexSignature: {
          keyType: 'string',
          valueType: { kind: 'intrinsic', intrinsic: 'number' } as any,
        },
      } as any;

      expect(formatType(objectType, false, undefined, true, [], {})).toBe(
        '{ [key: string]: number }',
      );
    });

    it('should preserve custom key names in index signatures', () => {
      const objectType = {
        kind: 'object',
        properties: [],
        indexSignature: {
          keyName: 'fileName',
          keyType: 'string',
          valueType: { kind: 'intrinsic', intrinsic: 'string' } as any,
        },
      } as any;

      expect(formatType(objectType, false, undefined, true, [], {})).toBe(
        '{ [fileName: string]: string }',
      );
    });

    it('should format object types with both properties and index signatures', () => {
      const objectType = {
        kind: 'object',
        properties: [
          {
            name: 'name',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
          } as any,
        ],
        indexSignature: {
          keyName: 'customKey',
          keyType: 'string',
          valueType: { kind: 'intrinsic', intrinsic: 'boolean' } as any,
        },
      } as any;

      expect(formatType(objectType, false, undefined, true, [], {})).toBe(
        '{ [customKey: string]: boolean; name: string }',
      );
    });

    it('should format object types with number index signatures', () => {
      const objectType = {
        kind: 'object',
        properties: [],
        indexSignature: {
          keyName: 'index',
          keyType: 'number',
          valueType: { kind: 'intrinsic', intrinsic: 'string' } as any,
        },
      } as any;

      expect(formatType(objectType, false, undefined, true, [], {})).toBe(
        '{ [index: number]: string }',
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

    it('should prevent self-referencing when typeName matches selfName', () => {
      // This tests the case where a type alias would reference itself
      // e.g., type BaseContentLoadingProps = BaseContentLoadingProps should expand the content
      const unionType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'BaseContentLoadingProps' } as any,
        types: [
          { kind: 'intrinsic', intrinsic: 'string' } as any,
          { kind: 'intrinsic', intrinsic: 'number' } as any,
        ],
      } as any;

      // When selfName matches typeName, should expand the union instead of using the alias
      const result = formatType(
        unionType,
        false,
        undefined,
        false,
        [],
        {},
        'BaseContentLoadingProps',
      );
      expect(result).toBe('string | number');

      // When selfName doesn't match, should use the alias
      const resultWithDifferentSelf = formatType(
        unionType,
        false,
        undefined,
        false,
        [],
        {},
        'OtherType',
      );
      expect(resultWithDifferentSelf).toBe('BaseContentLoadingProps');
    });

    it('should prevent self-referencing when qualifiedName (dotted) matches selfName', () => {
      // This tests the specific bug fix where a type like:
      //   type AccordionRootChangeEventReason = Accordion.Root.ChangeEventReason
      // was being generated because only the simple name was checked, not the qualified name.
      // The typeNameMap transforms AccordionRootChangeEventReason → Accordion.Root.ChangeEventReason
      // so when selfName is "Accordion.Root.ChangeEventReason", we need to expand the type.
      const unionType: tae.UnionNode = {
        kind: 'union',
        typeName: {
          name: 'AccordionRootChangeEventReason',
          namespaces: [],
        } as any,
        types: [
          { kind: 'literal', value: 'trigger-press' } as any,
          { kind: 'literal', value: 'none' } as any,
        ],
      } as any;

      const typeNameMap = {
        AccordionRootChangeEventReason: 'Accordion.Root.ChangeEventReason',
      };

      // When selfName is the dotted form (Accordion.Root.ChangeEventReason),
      // the type should be expanded because the qualifiedName would match selfName
      const result = formatType(
        unionType,
        false,
        undefined,
        false,
        [],
        typeNameMap,
        'Accordion.Root.ChangeEventReason', // selfName is the dotted form
      );
      // Should expand to the union members, not use the alias
      // Note: literal values are formatted without quotes
      expect(result).toBe('trigger-press | none');

      // When selfName is different, should use the qualified alias
      const resultNonSelf = formatType(
        unionType,
        false,
        undefined,
        false,
        [],
        typeNameMap,
        'OtherType',
      );
      expect(resultNonSelf).toBe('Accordion.Root.ChangeEventReason');
    });

    it('should prevent self-referencing with intersection types and namespaced selfName', () => {
      // Same bug fix but for intersection types
      const intersectionType: tae.IntersectionNode = {
        kind: 'intersection',
        typeName: {
          name: 'AccordionItemState',
          namespaces: [],
        } as any,
        types: [
          {
            kind: 'object',
            properties: [{ name: 'open', type: { kind: 'intrinsic', intrinsic: 'boolean' } }],
          } as any,
          {
            kind: 'object',
            properties: [{ name: 'disabled', type: { kind: 'intrinsic', intrinsic: 'boolean' } }],
          } as any,
        ],
      } as any;

      const typeNameMap = {
        AccordionItemState: 'Accordion.Item.State',
      };

      // When selfName matches the qualified name, should expand
      const result = formatType(
        intersectionType,
        false,
        undefined,
        false,
        [],
        typeNameMap,
        'Accordion.Item.State',
      );
      // Should expand to the intersection, not use the alias
      // When all members are objects, they should be merged into a single object
      expect(result).toBe('{ open: boolean; disabled: boolean }');

      // When selfName is different, should use the qualified alias
      const resultNonSelf = formatType(
        intersectionType,
        false,
        undefined,
        false,
        [],
        typeNameMap,
        'OtherType',
      );
      expect(resultNonSelf).toBe('Accordion.Item.State');
    });

    it('should filter out empty objects from intersection types', () => {
      // This tests the cleanup of `& {}` which comes from generic defaults
      // e.g., type Foo<T = {}> = { a: string } & T results in { a: string } & {}
      const intersectionWithEmptyObject: tae.IntersectionNode = {
        kind: 'intersection',
        types: [
          {
            kind: 'object',
            properties: [{ name: 'reason', type: { kind: 'literal', value: '"none"' } }],
          } as any,
          {
            kind: 'object',
            properties: [], // Empty object
          } as any,
        ],
      } as any;

      const result = formatType(intersectionWithEmptyObject, false, undefined, false, [], {});
      // Should strip the empty object, leaving just the non-empty part
      expect(result).toBe("{ reason: 'none' }");
    });

    it('should return empty object if all intersection members are empty', () => {
      const allEmptyIntersection: tae.IntersectionNode = {
        kind: 'intersection',
        types: [
          { kind: 'object', properties: [] } as any,
          { kind: 'object', properties: [] } as any,
        ],
      } as any;

      const result = formatType(allEmptyIntersection, false, undefined, false, [], {});
      expect(result).toBe('{}');
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
    it('should format function parameters with plain text types and HAST descriptions', async () => {
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
            tags: [
              {
                name: 'example',
                value: '```ts\n<Component options={{ key: "value" }} />\n```',
              },
            ],
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, [], {});

      // Parameter type is now plain text (HAST generation deferred to highlightTypesMeta)
      expect(result.value.typeText).toBe('string');
      expect(result.value.defaultText).toBeUndefined();
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

      // Parameter type is now plain text (HAST generation deferred to highlightTypesMeta)
      // Optional params have | undefined appended
      expect(result.options.typeText).toBe('object | undefined');
      // Default value is now plain text (HAST generation deferred to highlightTypesMeta)
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
      // Fenced code blocks are preserved (remark-typography doesn't affect code)
      expect(result.options.example).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'pre',
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-ts'] },
                children: [{ type: 'text', value: '<Component options={{ key: "value" }} />\n' }],
              },
            ],
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
      it('should format basic properties with plain text types and HAST descriptions', async () => {
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

        // typeText should be plain text (HAST generation deferred to highlightTypesMeta)
        expect(result.title.typeText).toBe('string');
      });
    });

    // NOTE: Tests for shortType, shortTypeText, and detailedType have been moved to
    // highlightTypesMeta.test.ts since these fields are now generated by highlightTypesMeta()
    // after highlightTypes() in the loadServerTypes pipeline.

    describe('detailed type selection (plain text fields only)', () => {
      it('should format event handler type as plain text', async () => {
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

        // formatProperties now only returns typeText (plain string)
        expect(result.onClick.typeText).toBeDefined();
        expect(typeof result.onClick.typeText).toBe('string');
      });

      it('should format className prop type as plain text', async () => {
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

        // formatProperties now only returns typeText (plain string)
        expect(result.className.typeText).toBeDefined();
        expect(typeof result.className.typeText).toBe('string');
        // typeText should contain the formatted type with | undefined for optional props
        expect(result.className.typeText).toBe('string | (() => string) | undefined');
      });

      it('should format simple types as plain text', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'title',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.title.typeText).toBe('string');
      });

      it('should not include type or shortType HAST fields (now deferred to highlightTypesMeta)', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'disabled',
            type: { kind: 'intrinsic', intrinsic: 'boolean' } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // These fields are now generated by highlightTypesMeta, not formatProperties
        expect((result.disabled as any).type).toBeUndefined();
        expect((result.disabled as any).shortType).toBeUndefined();
        expect((result.disabled as any).shortTypeText).toBeUndefined();
        expect((result.disabled as any).detailedType).toBeUndefined();

        // Plain text field should be present with | undefined for optional props
        expect(result.disabled.typeText).toBe('boolean | undefined');
      });

      it('should append | undefined to typeText for optional props', async () => {
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
                { kind: 'intrinsic', intrinsic: 'undefined' },
              ],
            } as any,
            optional: true,
            documentation: {} as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // typeText has | undefined appended for optional props (for HAST highlighting)
        // formatType strips it, but we add it back before returning
        expect(result.className.typeText).toBe('string | (() => string) | undefined');
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
        // Note: remark-typography inserts non-breaking space (\u00A0) before certain words
        expect(nonWhitespaceChildren[0]).toMatchObject({
          type: 'element',
          tagName: 'p',
          children: expect.arrayContaining([
            expect.objectContaining({ type: 'text', value: 'The value of the\u00A0input.' }),
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

    describe('remark-typography transformations', () => {
      it('should convert straight quotes to smart quotes', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Pass "hello" as the value.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // remark-typography converts "hello" to "hello" (smart quotes)
        // Also adds non-breaking space before "value"
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [{ type: 'text', value: 'Pass \u201Chello\u201D as the\u00A0value.' }],
            },
          ],
        });
      });

      it('should convert apostrophes to curly apostrophes', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: "It's working correctly.",
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // remark-typography converts ' to ' (right single quotation mark)
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [{ type: 'text', value: 'It\u2019s working correctly.' }],
            },
          ],
        });
      });

      it('should convert triple dots to ellipsis', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Loading... please wait.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // remark-typography converts ... to … (ellipsis)
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [{ type: 'text', value: 'Loading\u2026 please wait.' }],
            },
          ],
        });
      });

      it('should add non-breaking spaces before certain words', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'The value of the input.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // remark-typography adds non-breaking space before "input"
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [{ type: 'text', value: 'The value of the\u00A0input.' }],
            },
          ],
        });
      });

      it('should not transform content inside fenced code blocks', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: '```ts\nconst msg = "hello";\n```',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Code inside fenced blocks should preserve straight quotes
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'pre',
              children: [
                {
                  type: 'element',
                  tagName: 'code',
                  properties: { className: ['language-ts'] },
                  children: [{ type: 'text', value: 'const msg = "hello";\n' }],
                },
              ],
            },
          ],
        });
      });

      it('should not transform content inside inline code', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              description: 'Use `"string"` type.',
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        // Content inside inline code should preserve straight quotes
        expect(result.value.description).toMatchObject({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [
                { type: 'text', value: 'Use ' },
                {
                  type: 'element',
                  tagName: 'code',
                  children: [{ type: 'text', value: '"string"' }],
                },
                { type: 'text', value: ' type.' },
              ],
            },
          ],
        });
      });
    });

    // NOTE: Tests for HAST formatting of inline types have been moved to
    // highlightTypesMeta.test.ts since type HAST generation is now done by
    // highlightTypesMeta() after highlightTypes() in the loadServerTypes pipeline.
    // formatProperties now only returns plain text typeText strings.

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

      it('should return typeText string for type fields', async () => {
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

        // Verify typeText field contains plain string (HAST generation is in highlightTypesMeta)
        // Optional props have | undefined appended
        expect(result.callback.typeText).toBeDefined();
        expect(typeof result.callback.typeText).toBe('string');
        expect(result.callback.typeText).toBe('(() => void) | undefined');
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

    // NOTE: Tests for multiline union HAST formatting of default values have been
    // moved to highlightTypesMeta.test.ts since default HAST generation is now done
    // by highlightTypesMeta() after highlightTypes() in the loadServerTypes pipeline.
    // formatProperties now only returns plain text defaultText strings.

    describe('default value text formatting', () => {
      it('should return defaultText for union default values', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'variant',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: true,
            documentation: {
              defaultValue: "'primary' | 'secondary' | 'tertiary'",
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.variant.defaultText).toBe("'primary' | 'secondary' | 'tertiary'");
      });

      it('should return defaultText for simple default values', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'size',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: true,
            documentation: {
              defaultValue: "'medium'",
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, [], {});

        expect(result.size.defaultText).toBe("'medium'");
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
      // The typeText field contains the transformed type name as plain text
      expect(result.state.typeText).toBe('Menu.BackdropState');
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

import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatType, prettyFormatType } from './formatType';
import { formatProperties, formatDetailedType } from './format';

describe('formatType', () => {
  it('should format intrinsic types', () => {
    const stringType: tae.IntrinsicNode = {
      kind: 'intrinsic',
      intrinsic: 'string',
    } as any;

    expect(formatType(stringType, { exportNames: [], typeNameMap: {} })).toBe('string');
  });

  it('should format literal types', () => {
    const literalType: tae.LiteralNode = {
      kind: 'literal',
      value: '"test"',
    } as any;

    expect(formatType(literalType, { exportNames: [], typeNameMap: {} })).toBe("'test'");
  });

  it('should format array types', () => {
    const arrayType: tae.ArrayNode = {
      kind: 'array',
      elementType: {
        kind: 'intrinsic',
        intrinsic: 'string',
      } as any,
    } as any;

    expect(formatType(arrayType, { exportNames: [], typeNameMap: {} })).toBe('string[]');
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

    expect(formatType(arrayType, { exportNames: [], typeNameMap: {} })).toBe('(string | number)[]');
  });

  it('should format union types', () => {
    const unionType: tae.UnionNode = {
      kind: 'union',
      types: [
        { kind: 'intrinsic', intrinsic: 'string' } as any,
        { kind: 'intrinsic', intrinsic: 'number' } as any,
      ],
    } as any;

    expect(formatType(unionType, { exportNames: [], typeNameMap: {} })).toBe('string | number');
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
    expect(formatType(unionType, { exportNames: [], typeNameMap: {} })).toBe('StoreAtMode');
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
    expect(formatType(intersectionType, { exportNames: [], typeNameMap: {} })).toBe(
      'CombinedProps',
    );
  });

  it('should remove undefined from union types when requested', () => {
    const unionType: tae.UnionNode = {
      kind: 'union',
      types: [
        { kind: 'intrinsic', intrinsic: 'string' } as any,
        { kind: 'intrinsic', intrinsic: 'undefined' } as any,
      ],
    } as any;

    expect(formatType(unionType, { removeUndefined: true, exportNames: [], typeNameMap: {} })).toBe(
      'string',
    );
    expect(formatType(unionType, { exportNames: [], typeNameMap: {} })).toBe('string | undefined');
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

    expect(formatType(intersectionType, { exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [], typeNameMap: {} })).toBe(
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

    expect(formatType(tupleType, { exportNames: [], typeNameMap: {} })).toBe('[string, number]');
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

    expect(formatType(type, { jsdocTags: tags, exportNames: [], typeNameMap: {} })).toBe(
      'CustomType',
    );
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

    const result = formatType(unionType, { exportNames: [], typeNameMap: {} });
    const parts = result.split(' | ');

    // Check that any, null, undefined are at the end
    expect(parts[parts.length - 3]).toBe('any');
    expect(parts[parts.length - 2]).toBe('null');
    expect(parts[parts.length - 1]).toBe('undefined');
  });

  it('should expand type parameter to constraint by default', () => {
    const typeParam = {
      kind: 'typeParameter',
      name: 'T',
      constraint: { kind: 'intrinsic', intrinsic: 'string' },
      defaultValue: undefined,
    } as any;

    expect(formatType(typeParam, { exportNames: [], typeNameMap: {} })).toBe('string');
  });

  it('should preserve type parameter names when preserveTypeParameters is true', () => {
    const typeParam = {
      kind: 'typeParameter',
      name: 'T',
      constraint: { kind: 'intrinsic', intrinsic: 'string' },
      defaultValue: undefined,
    } as any;

    expect(
      formatType(typeParam, {
        exportNames: [],
        typeNameMap: {},
        preserveTypeParameters: true,
      }),
    ).toBe('T');
  });

  it('should preserve type parameter names without constraints', () => {
    const typeParam = {
      kind: 'typeParameter',
      name: 'T',
      constraint: undefined,
      defaultValue: undefined,
    } as any;

    // Without constraint, always returns name regardless of flag
    expect(formatType(typeParam, { exportNames: [], typeNameMap: {} })).toBe('T');
  });

  it('should preserve type parameter in intersection types when preserveTypeParameters is true', () => {
    const intersectionType = {
      kind: 'intersection',
      typeName: undefined,
      types: [
        {
          kind: 'typeParameter',
          name: 'T',
          constraint: { kind: 'object', typeName: undefined, properties: [] },
          defaultValue: undefined,
        },
        {
          kind: 'object',
          typeName: undefined,
          properties: [
            {
              name: 'value',
              type: { kind: 'intrinsic', intrinsic: 'string' },
              optional: false,
            },
          ],
        },
      ],
      properties: [],
    } as any;

    const result = formatType(intersectionType, {
      expandObjects: true,
      exportNames: [],
      typeNameMap: {},
      preserveTypeParameters: true,
    });
    expect(result).toContain('T');
    expect(result).toContain('value');
  });

  it('should expand type parameter constraint in intersection types by default', () => {
    const intersectionType = {
      kind: 'intersection',
      typeName: undefined,
      types: [
        {
          kind: 'typeParameter',
          name: 'T',
          constraint: { kind: 'object', typeName: undefined, properties: [] },
          defaultValue: undefined,
        },
        {
          kind: 'object',
          typeName: undefined,
          properties: [
            {
              name: 'value',
              type: { kind: 'intrinsic', intrinsic: 'string' },
              optional: false,
            },
          ],
        },
      ],
      properties: [],
    } as any;

    // Without the flag, T's constraint ({}) is expanded and filtered out,
    // leaving only the object with 'value'
    const result = formatType(intersectionType, {
      expandObjects: true,
      exportNames: [],
      typeNameMap: {},
    });
    expect(result).not.toContain('T');
    expect(result).toContain('value');
  });

  it('should expand type parameter to constraint when name matches selfName to avoid circular reference', () => {
    const typeParam = {
      kind: 'typeParameter',
      name: 'FormValues',
      constraint: {
        kind: 'object',
        typeName: { name: 'Record', typeArguments: [] },
        properties: [],
      },
      defaultValue: undefined,
    } as any;

    // Even with preserveTypeParameters=true, if the type param name matches
    // selfName, it should expand to avoid `type FormValues = FormValues;`
    const result = formatType(typeParam, {
      expandObjects: true,
      exportNames: [],
      typeNameMap: {},
      selfName: 'FormValues',
      preserveTypeParameters: true,
    });
    expect(result).not.toBe('FormValues');
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

      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((value: string, count: number) => void)');
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

      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((value: string, options?: object) => void)');
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

      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((value: string, options?: object) => void)');
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
      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((options: object | undefined, value: string) => void)');
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

      const result = formatType(functionType, {
        expandObjects: true,
        exportNames: [],
        typeNameMap: {},
      });
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

      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((a?: string, b?: number) => void)');
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

      const result = formatType(functionType, {
        expandObjects: true,
        exportNames: [],
        typeNameMap: {},
      });
      // Should be options?: object, not options?: undefined | object
      expect(result).toBe('((options?: object) => void)');
      expect(result).not.toContain('undefined');
    });

    it('should use type alias name for function types with typeName', () => {
      // Function types with a typeName (like OffsetFunction) should be shown by name
      // rather than expanded inline. This allows them to be documented as external types.
      const functionType: tae.FunctionNode = {
        kind: 'function',
        typeName: { name: 'OffsetFunction' },
        callSignatures: [
          {
            parameters: [
              {
                name: 'data',
                type: {
                  kind: 'object',
                  properties: [
                    { name: 'side', type: { kind: 'intrinsic', intrinsic: 'string' } as any },
                    { name: 'align', type: { kind: 'intrinsic', intrinsic: 'string' } as any },
                  ],
                } as any,
                optional: false,
              } as any,
            ],
            returnValueType: { kind: 'intrinsic', intrinsic: 'number' } as any,
          } as any,
        ],
      } as any;

      // With expandObjects=false, show the type name
      expect(formatType(functionType, { exportNames: [], typeNameMap: {} })).toBe('OffsetFunction');

      // With expandObjects=true, expand the signature
      expect(
        formatType(functionType, { expandObjects: true, exportNames: [], typeNameMap: {} }),
      ).toBe('((data: { side: string; align: string }) => number)');
    });

    it('should expand anonymous function types (no typeName)', () => {
      // Function types without a typeName are inline anonymous functions
      const functionType: tae.FunctionNode = {
        kind: 'function',
        typeName: undefined,
        callSignatures: [
          {
            parameters: [
              {
                name: 'event',
                type: { kind: 'intrinsic', intrinsic: 'object' } as any,
                optional: false,
              } as any,
            ],
            returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
          } as any,
        ],
      } as any;

      // Anonymous functions should always be expanded
      expect(formatType(functionType, { exportNames: [], typeNameMap: {} })).toBe(
        '((event: object) => void)',
      );
    });

    it('should use type alias name for function types with namespaces', () => {
      // Function types from other modules (with namespaces) should be shown by name
      const functionType: tae.FunctionNode = {
        kind: 'function',
        typeName: { name: 'RefCallback', namespaces: ['React'] },
        callSignatures: [
          {
            parameters: [
              {
                name: 'instance',
                type: { kind: 'intrinsic', intrinsic: 'object' } as any,
                optional: false,
              } as any,
            ],
            returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as any,
          } as any,
        ],
      } as any;

      // Has namespaces, so show as React.RefCallback
      expect(formatType(functionType, { exportNames: [], typeNameMap: {} })).toBe(
        'React.RefCallback',
      );
    });
  });
});

describe('prettyFormatType', () => {
  it('should format types with prettier on single line', async () => {
    const type: tae.IntrinsicNode = {
      kind: 'intrinsic',
      intrinsic: 'string',
    } as any;

    const result = await prettyFormatType(type, { exportNames: [], typeNameMap: {} });
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

    const result = await prettyFormatType(type, {
      expandObjects: true,
      exportNames: [],
      typeNameMap: {},
    });

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

    const result = await prettyFormatType(type, {
      expandObjects: true,
      exportNames: [],
      typeNameMap: {},
    });

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

    const result = formatType(externalType, { exportNames: [], typeNameMap });

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
    const result = formatType(typeWithArgs, { exportNames: [], typeNameMap });

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

    const result = formatType(externalType, { exportNames: [], typeNameMap });

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

    const result = formatType(externalType, { exportNames: [], typeNameMap });

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

    const result = await formatProperties(props, { exportNames: [], typeNameMap });

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

    const result = formatDetailedType(externalType, {
      allExports: [],
      exportNames: [],
      typeNameMap,
    });

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

    const result = formatType(externalType, { exportNames: [], typeNameMap: {} });

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

    const result = formatType(externalType, { exportNames: [], typeNameMap });

    expect(result).toBe('Menu.Root.Actions.Handler');
  });
});

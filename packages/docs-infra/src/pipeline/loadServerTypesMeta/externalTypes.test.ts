import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatType } from './formatType';
import { formatProperties } from './format';
import type { ExternalTypeMeta, ExternalTypesCollector } from './externalTypes';

/**
 * Creates an ExternalTypesCollector for use in tests.
 */
function createCollector(
  allExports: tae.ExportNode[] = [],
  pattern?: RegExp,
): ExternalTypesCollector {
  return {
    collected: new Map<string, ExternalTypeMeta>(),
    allExports,
    pattern,
  };
}

describe('external types collection via formatType', () => {
  it('should collect named union types with all literal members', () => {
    const orientationType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
        { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
      ],
    };

    const collector = createCollector();
    const result = formatType(orientationType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(result).toBe('Orientation');
    expect(collector.collected.size).toBe(1);
    expect(collector.collected.get('Orientation')).toEqual({
      name: 'Orientation',
      definition: "'horizontal' | 'vertical'",
    });
  });

  it('should convert double-quoted string literals to single quotes', () => {
    const storeAtModeType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'StoreAtMode', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: '"canonical"' } as tae.LiteralNode,
        { kind: 'literal', value: '"local"' } as tae.LiteralNode,
      ],
    };

    const collector = createCollector();
    formatType(storeAtModeType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(1);
    expect(collector.collected.get('StoreAtMode')).toEqual({
      name: 'StoreAtMode',
      definition: "'canonical' | 'local'",
    });
  });

  it('should not collect unnamed union types', () => {
    const unnamedUnion: tae.UnionNode = {
      kind: 'union',
      typeName: undefined,
      types: [
        { kind: 'literal', value: 'foo' } as tae.LiteralNode,
        { kind: 'literal', value: 'bar' } as tae.LiteralNode,
      ],
    };

    const collector = createCollector();
    formatType(unnamedUnion, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(0);
  });

  it('should not collect union types that contain non-literals', () => {
    const complexUnion: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'ComplexUnion', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'intrinsic', intrinsic: 'string' } as tae.IntrinsicNode,
        { kind: 'function', callSignatures: [] } as unknown as tae.FunctionNode,
      ],
    };

    const collector = createCollector();
    // formatType returns the alias name, but the collector does not collect
    // because not all members are literals/simple intrinsics
    const result = formatType(complexUnion, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(result).toBe('ComplexUnion');
    expect(collector.collected.size).toBe(0);
  });

  it('should skip types that are in allExports (own types)', () => {
    const stateType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'State', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'open' } as tae.LiteralNode,
        { kind: 'literal', value: 'closed' } as tae.LiteralNode,
      ],
    };

    const allExports = [{ name: 'State' }] as tae.ExportNode[];
    const collector = createCollector(allExports);
    formatType(stateType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(0);
  });

  it('should filter by pattern when provided', () => {
    const orientationType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
        { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
      ],
    };

    const sideType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'Side', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'top' } as tae.LiteralNode,
        { kind: 'literal', value: 'bottom' } as tae.LiteralNode,
      ],
    };

    const collector = createCollector([], /^Orientation$/);
    formatType(orientationType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });
    formatType(sideType, { exportNames: [], typeNameMap: {}, externalTypesCollector: collector });

    expect(collector.collected.size).toBe(1);
    expect(collector.collected.has('Orientation')).toBe(true);
    expect(collector.collected.has('Side')).toBe(false);
  });

  it('should skip React namespaced types', () => {
    const reactType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'ReactNode', namespaces: ['React'], typeArguments: undefined },
      types: [{ kind: 'literal', value: 'foo' } as tae.LiteralNode],
    };

    const collector = createCollector();
    formatType(reactType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(0);
  });

  it('should deduplicate when same type is encountered multiple times', () => {
    const orientationType: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
        { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
      ],
    };

    const collector = createCollector();
    formatType(orientationType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });
    formatType(orientationType, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(1);
  });

  it('should allow intrinsic types in unions (string, number, boolean)', () => {
    const mixedUnion: tae.UnionNode = {
      kind: 'union',
      typeName: { name: 'MixedUnion', namespaces: undefined, typeArguments: undefined },
      types: [
        { kind: 'literal', value: 'foo' } as tae.LiteralNode,
        { kind: 'literal', value: 'bar' } as tae.LiteralNode,
        { kind: 'intrinsic', intrinsic: 'boolean' } as tae.IntrinsicNode,
      ],
    };

    const collector = createCollector();
    formatType(mixedUnion, {
      exportNames: [],
      typeNameMap: {},
      externalTypesCollector: collector,
    });

    expect(collector.collected.size).toBe(1);
    expect(collector.collected.get('MixedUnion')).toBeDefined();
  });

  describe('nested external types', () => {
    it('should collect external type from function parameter', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const functionType: tae.FunctionNode = {
        kind: 'function',
        callSignatures: [
          {
            parameters: [{ name: 'orientation', type: orientationType }],
            returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as tae.IntrinsicNode,
          },
        ],
      } as tae.FunctionNode;

      const collector = createCollector();
      const result = formatType(functionType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(result).toBe('((orientation: Orientation) => void)');
      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toEqual({
        name: 'Orientation',
        definition: "'horizontal' | 'vertical'",
      });
    });

    it('should collect external type from function return type', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const functionType = {
        kind: 'function',
        callSignatures: [
          {
            parameters: [],
            returnValueType: orientationType,
          },
        ],
      } as unknown as tae.FunctionNode;

      const collector = createCollector();
      formatType(functionType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect external type from object property', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const objectType: tae.ObjectNode = {
        kind: 'object',
        properties: [
          { name: 'orientation', type: orientationType, optional: false },
          {
            name: 'disabled',
            type: { kind: 'intrinsic', intrinsic: 'boolean' } as tae.IntrinsicNode,
            optional: false,
          },
        ],
      } as tae.ObjectNode;

      const collector = createCollector();
      formatType(objectType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect external type from array element type', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const arrayType: tae.ArrayNode = {
        kind: 'array',
        elementType: orientationType,
      } as tae.ArrayNode;

      const collector = createCollector();
      const result = formatType(arrayType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(result).toBe('Orientation[]');
      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect external type from intersection member', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const intersectionType = {
        kind: 'intersection',
        types: [
          {
            kind: 'object',
            properties: [
              {
                name: 'disabled',
                type: { kind: 'intrinsic', intrinsic: 'boolean' } as tae.IntrinsicNode,
                optional: false,
              },
            ],
          } as tae.ObjectNode,
          {
            kind: 'object',
            properties: [{ name: 'orientation', type: orientationType, optional: false }],
          } as tae.ObjectNode,
        ],
      } as unknown as tae.IntersectionNode;

      const collector = createCollector();
      formatType(intersectionType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect external type from tuple element', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const tupleType: tae.TupleNode = {
        kind: 'tuple',
        types: [orientationType, { kind: 'intrinsic', intrinsic: 'number' } as tae.IntrinsicNode],
      } as tae.TupleNode;

      const collector = createCollector();
      formatType(tupleType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect external type from deeply nested structure', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const eventObjectType: tae.ObjectNode = {
        kind: 'object',
        properties: [{ name: 'orientation', type: orientationType, optional: false }],
      } as tae.ObjectNode;

      const callbackType: tae.FunctionNode = {
        kind: 'function',
        callSignatures: [
          {
            parameters: [{ name: 'event', type: eventObjectType }],
            returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as tae.IntrinsicNode,
          },
        ],
      } as tae.FunctionNode;

      const outerObjectType: tae.ObjectNode = {
        kind: 'object',
        properties: [{ name: 'onChange', type: callbackType, optional: false }],
      } as tae.ObjectNode;

      const collector = createCollector();
      formatType(outerObjectType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect multiple external types from nested structure', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const sideType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Side', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'top' } as tae.LiteralNode,
          { kind: 'literal', value: 'bottom' } as tae.LiteralNode,
          { kind: 'literal', value: 'left' } as tae.LiteralNode,
          { kind: 'literal', value: 'right' } as tae.LiteralNode,
        ],
      };

      const detailsType: tae.ObjectNode = {
        kind: 'object',
        properties: [
          { name: 'orientation', type: orientationType, optional: false },
          { name: 'side', type: sideType, optional: false },
        ],
      } as tae.ObjectNode;

      const callbackType: tae.FunctionNode = {
        kind: 'function',
        callSignatures: [
          {
            parameters: [
              {
                name: 'value',
                type: { kind: 'intrinsic', intrinsic: 'string' } as tae.IntrinsicNode,
              },
              { name: 'details', type: detailsType },
            ],
            returnValueType: { kind: 'intrinsic', intrinsic: 'void' } as tae.IntrinsicNode,
          },
        ],
      } as tae.FunctionNode;

      const collector = createCollector();
      formatType(callbackType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(2);
      expect(collector.collected.get('Orientation')).toBeDefined();
      expect(collector.collected.get('Side')).toBeDefined();
      expect(collector.collected.get('Side')?.definition).toBe(
        "'top' | 'bottom' | 'left' | 'right'",
      );
    });

    it('should collect external type from union containing the type', () => {
      const orientationType: tae.UnionNode = {
        kind: 'union',
        typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
        types: [
          { kind: 'literal', value: 'horizontal' } as tae.LiteralNode,
          { kind: 'literal', value: 'vertical' } as tae.LiteralNode,
        ],
      };

      const nullableOrientationType: tae.UnionNode = {
        kind: 'union',
        typeName: undefined,
        types: [
          orientationType,
          { kind: 'intrinsic', intrinsic: 'null' } as tae.IntrinsicNode,
          { kind: 'intrinsic', intrinsic: 'undefined' } as tae.IntrinsicNode,
        ],
      };

      const collector = createCollector();
      formatType(nullableOrientationType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('Orientation')).toBeDefined();
    });

    it('should collect named function type as external type', () => {
      const offsetFunctionType: tae.FunctionNode = {
        kind: 'function',
        typeName: { name: 'OffsetFunction', namespaces: undefined, typeArguments: undefined },
        callSignatures: [
          {
            parameters: [
              {
                name: 'data',
                type: {
                  kind: 'object',
                  properties: [
                    {
                      name: 'side',
                      type: {
                        kind: 'union',
                        typeName: { name: 'Side' },
                        types: [
                          { kind: 'literal', value: 'top' } as tae.LiteralNode,
                          { kind: 'literal', value: 'bottom' } as tae.LiteralNode,
                        ],
                      },
                      optional: false,
                    },
                  ],
                } as unknown as tae.ObjectNode,
                optional: false,
              },
            ],
            returnValueType: {
              kind: 'intrinsic',
              intrinsic: 'number',
            } as unknown as tae.IntrinsicNode,
          },
        ],
      } as tae.FunctionNode;

      const collector = createCollector();
      const result = formatType(offsetFunctionType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      // formatType returns the alias name without expanding
      expect(result).toBe('OffsetFunction');

      // Only the top-level OffsetFunction is collected (Side is not visible in formatted output)
      expect(collector.collected.size).toBe(1);
      expect(collector.collected.get('OffsetFunction')).toBeDefined();
      expect(collector.collected.get('OffsetFunction')?.definition).toBe(
        "(data: { side: 'top' | 'bottom' }) => number",
      );
    });

    it('should not collect anonymous function types', () => {
      const anonymousFunctionType: tae.FunctionNode = {
        kind: 'function',
        typeName: undefined,
        callSignatures: [
          {
            parameters: [
              {
                name: 'event',
                type: { kind: 'intrinsic', intrinsic: 'object' } as unknown as tae.IntrinsicNode,
                optional: false,
              },
            ],
            returnValueType: {
              kind: 'intrinsic',
              intrinsic: 'void',
            } as unknown as tae.IntrinsicNode,
          },
        ],
      } as tae.FunctionNode;

      const collector = createCollector();
      formatType(anonymousFunctionType, {
        exportNames: [],
        typeNameMap: {},
        externalTypesCollector: collector,
      });

      expect(collector.collected.size).toBe(0);
    });
  });

  it('should collect external types via formatProperties', async () => {
    const props: tae.PropertyNode[] = [
      {
        name: 'orientation',
        type: {
          kind: 'union',
          typeName: { name: 'Orientation', namespaces: undefined, typeArguments: undefined },
          types: [
            { kind: 'literal', value: 'horizontal' },
            { kind: 'literal', value: 'vertical' },
          ],
        },
      } as unknown as tae.PropertyNode,
      {
        name: 'side',
        type: {
          kind: 'union',
          typeName: { name: 'Side', namespaces: undefined, typeArguments: undefined },
          types: [
            { kind: 'literal', value: 'top' },
            { kind: 'literal', value: 'bottom' },
          ],
        },
      } as unknown as tae.PropertyNode,
    ];

    const collector = createCollector();
    await formatProperties(props, { exportNames: [], typeNameMap: {}, externalTypes: collector });

    expect(collector.collected.size).toBe(2);
    expect(collector.collected.has('Orientation')).toBe(true);
    expect(collector.collected.has('Side')).toBe(true);
  });
});

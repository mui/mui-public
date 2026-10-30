import { describe, it, expect } from 'vitest';
import type * as tae from '@mui/internal-typescript-api-extractor';
import { formatType, prettyFormatType } from './formatType';
import { parseTestSources } from './parseTestSources';
import { isObjectType } from './typeGuards';
import type { ExternalTypesCollector } from './externalTypes';

describe('formatType', () => {
  it('should format intrinsic types', () => {
    const stringType: tae.IntrinsicNode = {
      kind: 'intrinsic',
      intrinsic: 'string',
    } as any;

    expect(formatType(stringType, { exportNames: [] })).toBe('string');
  });

  it('should format literal types', () => {
    const literalType: tae.LiteralNode = {
      kind: 'literal',
      value: '"test"',
    } as any;

    expect(formatType(literalType, { exportNames: [] })).toBe("'test'");
  });

  it('should format array types', () => {
    const arrayType: tae.ArrayNode = {
      kind: 'array',
      elementType: {
        kind: 'intrinsic',
        intrinsic: 'string',
      } as any,
    } as any;

    expect(formatType(arrayType, { exportNames: [] })).toBe('string[]');
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

    expect(formatType(arrayType, { exportNames: [] })).toBe('(string | number)[]');
  });

  it('should format union types', () => {
    const unionType: tae.UnionNode = {
      kind: 'union',
      types: [
        { kind: 'intrinsic', intrinsic: 'string' } as any,
        { kind: 'intrinsic', intrinsic: 'number' } as any,
      ],
    } as any;

    expect(formatType(unionType, { exportNames: [] })).toBe('string | number');
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
    expect(formatType(unionType, { exportNames: [] })).toBe('StoreAtMode');
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
    expect(formatType(intersectionType, { exportNames: [] })).toBe('CombinedProps');
  });

  it('should remove undefined from union types when requested', () => {
    const unionType: tae.UnionNode = {
      kind: 'union',
      types: [
        { kind: 'intrinsic', intrinsic: 'string' } as any,
        { kind: 'intrinsic', intrinsic: 'undefined' } as any,
      ],
    } as any;

    expect(formatType(unionType, { removeUndefined: true, exportNames: [] })).toBe('string');
    expect(formatType(unionType, { exportNames: [] })).toBe('string | undefined');
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

    expect(formatType(intersectionType, { exportNames: [] })).toBe('{ a: string; b: number }');
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [] })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [] })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [] })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [] })).toBe(
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

    expect(formatType(objectType, { expandObjects: true, exportNames: [] })).toBe(
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

    expect(formatType(tupleType, { exportNames: [] })).toBe('[string, number]');
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

    expect(formatType(type, { jsdocTags: tags, exportNames: [] })).toBe('CustomType');
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

    const result = formatType(unionType, { exportNames: [] });
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

    expect(formatType(typeParam, { exportNames: [] })).toBe('string');
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
    expect(formatType(typeParam, { exportNames: [] })).toBe('T');
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
      selfName: 'FormValues',
      preserveTypeParameters: true,
    });
    expect(result).not.toBe('FormValues');
  });

  // Declared in the virtual library so they are external to the parsed source. The parser
  // only preserves `keyof` over an operand it will not expand; a locally declared interface
  // is expanded to its keys before it ever reaches the formatter.
  const LIB = [
    'interface Config { size: string; color: string; }',
    'interface Meta { id: string; }',
    "type Tone = 'muted' | 'loud';",
    // A built-in namespace, and the utility types that wrap other types by name.
    'declare namespace React { namespace JSX { interface IntrinsicElements { a: unknown; div: unknown; } } }',
    'type Exclude<T, U> = T extends U ? never : T;',
    'type Omit<T, K> = { [P in Exclude<keyof T, K>]: T[P] };',
    // Shares a prefix with the built-in `Pick` without being one.
    'interface PickerConfig { hour: string; minute: string; }',
  ].join('\n');

  /** Formats one property of the parsed interface, the way the props tables do. */
  function formatProp(
    source: string,
    propName: string,
    options: { preserveTypeParameters?: boolean } = {},
  ): string {
    const [exportNode] = parseTestSources({ 'types.ts': source }, { lib: LIB });
    if (!isObjectType(exportNode.type)) {
      throw new Error(`expected an object export, received "${exportNode.type.kind}"`);
    }
    const property = exportNode.type.properties.find((prop) => prop.name === propName);
    if (!property) {
      throw new Error(`property "${propName}" not found`);
    }
    return formatType(property.type, {
      removeUndefined: property.optional,
      exportNames: [],
      ...options,
    });
  }

  /** Formats the parsed type alias itself. */
  function formatAlias(source: string, parserOptions?: tae.ParserOptions): string {
    const [exportNode] = parseTestSources({ 'types.ts': source }, { lib: LIB, parserOptions });
    return formatType(exportNode.type, { exportNames: [] });
  }

  describe('type operator formatting', () => {
    it('should expand a keyof operator alongside other members of a union', () => {
      const source = 'export interface Props {\n  match?: boolean | keyof Config;\n}';

      expect(formatProp(source, 'match')).toBe("boolean | 'size' | 'color'");
    });

    it('should expand a keyof operator standing alone', () => {
      const source = 'export interface Props {\n  all?: keyof Config;\n}';

      expect(formatProp(source, 'all')).toBe("'size' | 'color'");
    });

    it('should expand a keyof operator over a generic to its base constraint', () => {
      const source = 'export interface Box<T> {\n  key?: keyof T;\n}';

      expect(formatProp(source, 'key')).toBe('string | number | symbol');
    });

    it('should keep a keyof operator over a generic by name in raw declarations', () => {
      const source = 'export interface Box<T> {\n  key?: keyof T;\n}';

      // Raw declarations render the constraint on `<T>` itself, so resolving the operator
      // here would drop the generic identity and leave the declared `T` unused.
      expect(formatProp(source, 'key', { preserveTypeParameters: true })).toBe('keyof T');
    });

    it('should still expand a keyof operator over a concrete type in raw declarations', () => {
      const source = 'export interface Box<T> {\n  tone?: keyof Config;\n  other?: T;\n}';

      expect(formatProp(source, 'tone', { preserveTypeParameters: true })).toBe("'size' | 'color'");
    });

    it('should not repeat a key the union already lists next to the operator', () => {
      const source = "export interface Props {\n  tone?: 'size' | keyof Config;\n}";

      expect(formatProp(source, 'tone')).toBe("'size' | 'color'");
    });

    it('should keep an operator kept by name out of the surrounding union', () => {
      const source = "export interface Box<T> {\n  key?: 'size' | keyof T;\n}";

      // The operator stays whole here, so its base constraint must not be flattened into
      // the union alongside the sibling literal.
      expect(formatProp(source, 'key', { preserveTypeParameters: true })).toBe("'size' | keyof T");
    });

    it('should keep a keyof operator over a built-in type as written', () => {
      const source = 'export interface Props {\n  tag?: keyof React.JSX.IntrinsicElements;\n}';
      // Readers already know the built-in, and its keys are too many to be worth listing.
      expect(formatProp(source, 'tag')).toBe('keyof React.JSX.IntrinsicElements');
    });

    it('should expand a keyof operator over a built-in wrapping a documented type', () => {
      const source = "export interface Props {\n  key?: keyof Omit<Config, 'size'>;\n}";
      // The keys come from `Config`, so naming the wrapper would document nothing.
      expect(formatProp(source, 'key')).toBe("'color'");
    });

    it('should expand a keyof operator over a type that merely starts with a built-in name', () => {
      const source = 'export interface Props {\n  unit?: keyof PickerConfig;\n}';
      expect(formatProp(source, 'unit')).toBe("'hour' | 'minute'");
    });

    it('should expand a keyof operator over a type query', () => {
      const source = 'const value = { alpha: 1, beta: 2 };\nexport type Keys = keyof typeof value;';

      expect(formatAlias(source)).toBe("'alpha' | 'beta'");
    });

    it('should group a composite operand in the authored syntax', () => {
      const source = 'export type Keys = keyof (Config | Meta);';

      // `keyof` binds tighter than `|`, so an ungrouped operand would read as
      // `(keyof Config) | Meta`.
      expect(formatAlias(source, { typeOperatorOutput: 'syntaxOnly' })).toBe(
        'keyof (Config | Meta)',
      );
    });

    it('should fall back to the authored syntax when the parser omits the resolved type', () => {
      const source = 'const value = { alpha: 1, beta: 2 };\nexport type Keys = keyof typeof value;';

      expect(formatAlias(source, { typeOperatorOutput: 'syntaxOnly' })).toBe('keyof typeof value');
    });
  });

  describe('intersection grouping', () => {
    it('should group a union member so it binds before the intersection', () => {
      const source = 'export interface Props {\n  tone: keyof Config & Meta;\n}';

      expect(formatProp(source, 'tone')).toBe("('size' | 'color') & Meta");
    });

    it('should group a union member intersected with an intrinsic', () => {
      const source = 'export interface Props {\n  tone: keyof Config & string;\n}';

      expect(formatProp(source, 'tone')).toBe("('size' | 'color') & string");
    });

    it('should leave intersection members of a union ungrouped', () => {
      const source = 'export interface Props {\n  tone: Tone & Meta;\n}';

      // `&` already binds tighter than `|`, so these read correctly as written.
      expect(formatProp(source, 'tone')).toBe("'muted' & Meta | 'loud' & Meta");
    });

    it('should not group a union nested inside a member', () => {
      const source = 'export interface Props {\n  tone: keyof Config & { x: string | number };\n}';

      // The object member's own braces already group its pipe, so only the operand is
      // wrapped.
      expect(formatProp(source, 'tone')).toBe("('size' | 'color') & { x: string | number }");
    });
  });

  // The `${}` in these strings is template literal type syntax, not interpolation.
  /* eslint-disable no-template-curly-in-string */
  describe('template literal formatting', () => {
    it('should format a template literal with its placeholders', () => {
      const source = 'export interface Props {\n  width?: `${number}px`;\n}';

      expect(formatProp(source, 'width')).toBe('`${number}px`');
    });

    it('should keep a type parameter placeholder by name in raw declarations', () => {
      const source = 'export interface Listener<T extends string> {\n  event: `on${T}`;\n}';

      expect(formatProp(source, 'event')).toBe('`on${string}`');
      expect(formatProp(source, 'event', { preserveTypeParameters: true })).toBe('`on${T}`');
    });

    it('should keep a referenced template literal alias by name', () => {
      const source =
        "type Percentage = `${number}%`;\nexport interface Props {\n  minimum: number | Percentage | 'auto';\n}";

      expect(formatProp(source, 'minimum')).toBe("number | Percentage | 'auto'");
    });

    it('should escape text that would change the template when read back', () => {
      const source = 'export type Code = `\\`\\${${string}}\\\\\\r`;';

      // A raw carriage return would be read back as a line feed.
      expect(formatAlias(source)).toBe('`\\`\\${${string}}\\\\\\r`');
    });
  });
  /* eslint-enable no-template-curly-in-string */

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

      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
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

      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
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

      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
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
      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
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

      const result = formatType(functionType, {
        expandObjects: true,
        exportNames: [],
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

      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
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

      const result = formatType(functionType, {
        expandObjects: true,
        exportNames: [],
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
      expect(formatType(functionType, { exportNames: [] })).toBe('OffsetFunction');

      // With expandObjects=true, expand the signature
      expect(formatType(functionType, { expandObjects: true, exportNames: [] })).toBe(
        '((data: { side: string; align: string }) => number)',
      );
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
      expect(formatType(functionType, { exportNames: [] })).toBe('((event: object) => void)');
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
      expect(formatType(functionType, { exportNames: [] })).toBe('React.RefCallback');
    });
  });
});

describe('prettyFormatType', () => {
  it('should format types with prettier on single line', async () => {
    const type: tae.IntrinsicNode = {
      kind: 'intrinsic',
      intrinsic: 'string',
    } as any;

    const result = await prettyFormatType(type, { exportNames: [] });
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
    });

    // Should include formatted properties
    expect(result).toContain('prop');
    expect(result).toContain('string');
  });
});

describe('external type sources', () => {
  const LIB = 'interface Element {}\ninterface Range {}\ninterface Box<T> {}';

  /**
   * Formats every property of the `Props` export and returns the sources the collector recorded.
   */
  function collectSources(sources: Record<string, string>) {
    const exports = parseTestSources(sources, {
      lib: LIB,
      installedLib: true,
    });
    const props = exports.find((exportNode) => exportNode.name === 'Props');
    if (!props || !isObjectType(props.type)) {
      throw new Error('expected a `Props` object export');
    }
    const collector: ExternalTypesCollector = {
      collected: new Map(),
      sources: new Map(),
      allExports: exports,
    };
    for (const property of props.type.properties) {
      formatType(property.type, {
        removeUndefined: property.optional,
        exportNames: exports.map((exportNode) => exportNode.name),
        externalTypesCollector: collector,
      });
    }
    return Object.fromEntries(collector.sources);
  }

  it('records where an external type is declared', () => {
    expect(collectSources({ 'types.ts': 'export interface Props { el: Element }' })).toEqual({
      Element: { kind: 'lib', files: ['lib.d.ts'] },
    });
  });

  it('records the external type of an optional prop', () => {
    expect(collectSources({ 'types.ts': 'export interface Props { el?: Element }' })).toEqual({
      Element: { kind: 'lib', files: ['lib.d.ts'] },
    });
  });

  it('does not give an alias the source of the external type it wraps', () => {
    const source =
      'type MaybeElement = Element | null;\nexport interface Props { el: MaybeElement }';

    expect(collectSources({ 'types.ts': source })).toEqual({ MaybeElement: null });
  });

  it('records external types in type arguments', () => {
    expect(collectSources({ 'types.ts': 'export interface Props { box: Box<Element> }' })).toEqual({
      Box: { kind: 'lib', files: ['lib.d.ts'] },
      Element: { kind: 'lib', files: ['lib.d.ts'] },
    });
  });

  it('leaves a lib type unlinked when the page also prints its own type with that name', () => {
    const sources = {
      'types.ts': [
        "import type { Chart } from './chart';",
        "export interface Props { dom: Range; chart: Chart['range'] }",
      ].join('\n'),
      'chart.ts': [
        'export interface Range { start: number; end: number }',
        'export interface Chart { range: Range }',
      ].join('\n'),
    };

    expect(collectSources(sources)).toEqual({ Range: null });
  });

  it('marks a name printed for types from different declarations as ambiguous', () => {
    const sources = {
      'types.ts': [
        "import type { Range as PackageRange } from './node_modules/shadow/index';",
        'export interface Props { dom: Range; shadow: PackageRange }',
      ].join('\n'),
      'node_modules/shadow/index.d.ts': 'export interface Range { start: number }',
    };

    expect(collectSources(sources)).toEqual({ Range: null });
  });
});

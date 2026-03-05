import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import type { Element as HastElement } from 'hast';
import {
  formatProperties,
  formatParameters,
  formatDetailedType,
  formatEnum,
  formatSeeTags,
  formatTypeParameterDeclaration,
  extractTypeParameters,
} from './format';
import { formatType } from './formatType';

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

      const result = formatDetailedType(externalType, {
        allExports: exportNodes,
        exportNames: [],
        typeNameMap: {},
      });
      expect(result).toBe('{ prop: string }');
    });

    it('should handle circular references', () => {
      const exportNodes: tae.ExportNode[] = [];
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: { name: 'CircularType' } as any,
      } as any;

      // Should not throw and return the type name
      const result = formatDetailedType(externalType, {
        allExports: exportNodes,
        exportNames: ['CircularType'],
        typeNameMap: {},
      });
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
      const result = formatType(unionType, {
        exportNames: [],
        typeNameMap: {},
        selfName: 'BaseContentLoadingProps',
      });
      expect(result).toBe('string | number');

      // When selfName doesn't match, should use the alias
      const resultWithDifferentSelf = formatType(unionType, {
        exportNames: [],
        typeNameMap: {},
        selfName: 'OtherType',
      });
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
      const result = formatType(unionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'Accordion.Root.ChangeEventReason', // selfName is the dotted form
      });
      // Should expand to the union members, not use the alias
      // Note: literal values are formatted without quotes
      expect(result).toBe('trigger-press | none');

      // When selfName is different, should use the qualified alias
      const resultNonSelf = formatType(unionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'OtherType',
      });
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
      const result = formatType(intersectionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'Accordion.Item.State',
      });
      // Should expand to the intersection, not use the alias
      // When all members are objects, they should be merged into a single object
      expect(result).toBe('{ open: boolean; disabled: boolean }');

      // When selfName is different, should use the qualified alias
      const resultNonSelf = formatType(intersectionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'OtherType',
      });
      expect(resultNonSelf).toBe('Accordion.Item.State');
    });

    it('should prevent self-referencing when qualifiedName has type arguments', () => {
      // This tests the fix where a type like:
      //   type TabsRootChangeEventDetails = Tabs.Root.ChangeEventDetails<'none', { ... }>
      // was being generated because the type arguments weren't stripped before comparing.
      // When the qualifiedName includes type args (Tabs.Root.ChangeEventDetails<'none', ...>),
      // we need to strip them to match selfName (Tabs.Root.ChangeEventDetails).
      const unionType: tae.UnionNode = {
        kind: 'union',
        typeName: {
          name: 'TabsRootChangeEventDetails',
          namespaces: [],
          typeArguments: [
            {
              type: { kind: 'literal', value: "'none'" } as any,
              equalToDefault: false, // Type arg differs from default, so it should be shown
            },
            {
              type: {
                kind: 'object',
                properties: [
                  { name: 'activationDirection', type: { kind: 'intrinsic', intrinsic: 'string' } },
                ],
              } as any,
              equalToDefault: false,
            },
          ],
        } as any,
        types: [
          {
            kind: 'object',
            properties: [
              { name: 'reason', type: { kind: 'literal', value: "'none'" } },
              { name: 'activationDirection', type: { kind: 'intrinsic', intrinsic: 'string' } },
            ],
          } as any,
        ],
      } as any;

      const typeNameMap = {
        TabsRootChangeEventDetails: 'Tabs.Root.ChangeEventDetails',
      };

      // When selfName matches the base qualifiedName (without type args), should expand
      const result = formatType(unionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'Tabs.Root.ChangeEventDetails', // selfName without type args
      });
      // Should expand to the object type, not use the alias with type args
      expect(result).toBe("{ reason: 'none'; activationDirection: string }");

      // When selfName is different, should use the qualified alias with type args
      const resultNonSelf = formatType(unionType, {
        exportNames: [],
        typeNameMap,
        selfName: 'OtherType',
      });
      // Should include the type arguments in the output
      expect(resultNonSelf).toBe(
        "Tabs.Root.ChangeEventDetails<'none', { activationDirection: string }>",
      );
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

      const result = formatType(intersectionWithEmptyObject, { exportNames: [], typeNameMap: {} });
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

      const result = formatType(allEmptyIntersection, { exportNames: [], typeNameMap: {} });
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

      const result = formatDetailedType(unionType, {
        allExports: exportNodes,
        exportNames: [],
        typeNameMap: {},
      });
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

      const result = formatDetailedType(intersectionType, {
        allExports: exportNodes,
        exportNames: [],
        typeNameMap: {},
      });
      expect(result).toBe('{ a: string } & { b: number }');
    });

    it('should handle known external aliases like Padding', () => {
      const externalType: tae.ExternalTypeNode = {
        kind: 'external',
        typeName: { name: 'Padding' } as any,
      } as any;

      const result = formatDetailedType(externalType, {
        allExports: [],
        exportNames: [],
        typeNameMap: {},
      });
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

      const result = await formatParameters(params, { exportNames: [], typeNameMap: {} });

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

      const result = await formatParameters(params, { exportNames: [], typeNameMap: {} });

      // Unfenced example text gets wrapped in ```tsx fences, producing a code block
      expect(result.value.example).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'pre',
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-tsx'] },
                children: [
                  { type: 'text', value: expect.stringContaining('Example 1\nExample 2') },
                ],
              },
            ],
          },
        ],
      });
    });

    it('should not wrap already-fenced example tags', async () => {
      const params: tae.Parameter[] = [
        {
          name: 'value',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: false,
          documentation: {
            tags: [{ name: 'example', value: '```ts\nconst x = 1;\n```' }],
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, { exportNames: [], typeNameMap: {} });

      // Already-fenced example should remain as-is with the original language
      expect(result.value.example).toMatchObject({
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
                children: [{ type: 'text', value: expect.stringContaining('const x = 1;') }],
              },
            ],
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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, {
          exportNames: [],
          typeNameMap: {},
          isComponentContext: true,
        });

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
        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

      it('should wrap unfenced example in tsx code fence', async () => {
        const props: tae.PropertyNode[] = [
          {
            name: 'value',
            type: { kind: 'intrinsic', intrinsic: 'string' } as any,
            optional: false,
            documentation: {
              tags: [{ name: 'example', value: '{ isActive: (value) => value > 0 }' }],
            } as any,
          } as any,
        ];

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

        // Unfenced example text gets wrapped in ```tsx fences
        expect(result.value.example).toBeDefined();
        expect(result.value.example!.children[0]).toMatchObject({
          type: 'element',
          tagName: 'pre',
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-tsx'] },
              children: [
                {
                  type: 'text',
                  value: expect.stringContaining('{ isActive: (value) => value > 0 }'),
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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

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

        const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

        expect(result.size.defaultText).toBe("'medium'");
      });
    });
  });

  describe('formatSeeTags', () => {
    it('should format a bare URL into a bullet item with a link', () => {
      expect(formatSeeTags(['http://external.example/path'])).toBe(
        '- See [external.example](http://external.example/path)',
      );
    });

    it('should format {@link URL} into a bullet item', () => {
      expect(formatSeeTags(['{@link http://external.example/path}'])).toBe(
        '- See [external.example](http://external.example/path)',
      );
    });

    it('should format {@link URL|Text} with custom label', () => {
      expect(formatSeeTags(['{@link http://external.example/path|External Docs}'])).toBe(
        '- See [External Docs](http://external.example/path)',
      );
    });

    it('should preserve trailing text after {@link}', () => {
      expect(formatSeeTags(['{@link http://external.example/path} for further information.'])).toBe(
        '- See [external.example](http://external.example/path) for further information.',
      );
    });

    it('should format multiple @see tags as separate bullet items', () => {
      expect(
        formatSeeTags([
          '{@link http://external.example/path} for further information.',
          '{@link http://external.example/path|External Docs}',
        ]),
      ).toBe(
        '- See [external.example](http://external.example/path) for further information.\n- See [External Docs](http://external.example/path)',
      );
    });

    it('should handle plain text references', () => {
      expect(formatSeeTags(['SomeOtherComponent'])).toBe('- See SomeOtherComponent');
    });

    it('should return undefined for empty input', () => {
      expect(formatSeeTags([])).toBeUndefined();
    });

    it('should filter out undefined and empty values', () => {
      expect(formatSeeTags([undefined, '', '  ', '{@link http://external.example/path}'])).toBe(
        '- See [external.example](http://external.example/path)',
      );
    });

    it('should strip www. from domain labels', () => {
      expect(formatSeeTags(['{@link https://www.external.example/path}'])).toBe(
        '- See [external.example](https://www.external.example/path)',
      );
    });

    it('should handle bare URL with trailing text', () => {
      expect(formatSeeTags(['https://external.example/path for more details'])).toBe(
        '- See [external.example](https://external.example/path) for more details',
      );
    });

    it('should restore https protocol when extractor truncates bare URL @see tags', () => {
      expect(
        formatSeeTags(['://external.example/en-US/docs/Web/HTML/Attributes/autocomplete']),
      ).toBe(
        '- See [external.example](https://external.example/en-US/docs/Web/HTML/Attributes/autocomplete)',
      );
    });
  });

  describe('formatProperties @see extraction', () => {
    it('should extract @see tags into seeText', async () => {
      const props: tae.PropertyNode[] = [
        {
          name: 'variant',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: true,
          documentation: {
            description: 'The button variant',
            tags: [{ name: 'see', value: '{@link https://external.example/path|Docs}' }],
          } as any,
        } as any,
      ];

      const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

      expect(result.variant.seeText).toBe('- See [Docs](https://external.example/path)');
      expect(result.variant.see).toBeDefined();
      expect(result.variant.see?.type).toBe('root');
    });

    it('should extract multiple @see tags into bullet list', async () => {
      const props: tae.PropertyNode[] = [
        {
          name: 'variant',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: true,
          documentation: {
            description: 'The button variant',
            tags: [
              { name: 'see', value: '{@link https://external.example/path|Docs}' },
              { name: 'see', value: '{@link https://other.external.example/path}' },
            ],
          } as any,
        } as any,
      ];

      const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

      expect(result.variant.seeText).toBe(
        '- See [Docs](https://external.example/path)\n- See [other.external.example](https://other.external.example/path)',
      );
    });

    it('should not set see fields when no @see tags present', async () => {
      const props: tae.PropertyNode[] = [
        {
          name: 'variant',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: true,
          documentation: {
            description: 'The button variant',
          } as any,
        } as any,
      ];

      const result = await formatProperties(props, { exportNames: [], typeNameMap: {} });

      expect(result.variant.seeText).toBeUndefined();
      expect(result.variant.see).toBeUndefined();
    });
  });

  describe('formatParameters @see extraction', () => {
    it('should extract @see tags into seeText', async () => {
      const params: tae.Parameter[] = [
        {
          name: 'value',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: false,
          documentation: {
            description: 'The input value',
            tags: [{ name: 'see', value: '{@link https://external.example/path|External docs}' }],
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, { exportNames: [], typeNameMap: {} });

      expect(result.value.seeText).toBe('- See [External docs](https://external.example/path)');
      expect(result.value.see).toBeDefined();
      expect(result.value.see?.type).toBe('root');
    });

    it('should not set see fields when no @see tags present', async () => {
      const params: tae.Parameter[] = [
        {
          name: 'value',
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          optional: false,
          documentation: {
            description: 'The input value',
          } as any,
        } as any,
      ];

      const result = await formatParameters(params, { exportNames: [], typeNameMap: {} });

      expect(result.value.seeText).toBeUndefined();
      expect(result.value.see).toBeUndefined();
    });
  });

  describe('formatTypeParameterDeclaration', () => {
    it('should return empty string for empty type arguments', () => {
      expect(formatTypeParameterDeclaration([])).toBe('');
    });

    it('should return empty string when no args are TypeParameterNodes', () => {
      const args = [
        { type: { kind: 'intrinsic', intrinsic: 'string' } as any, equalToDefault: false },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('');
    });

    it('should format a simple type parameter', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'T',
            constraint: undefined,
            defaultValue: undefined,
          } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<T>');
    });

    it('should format a type parameter with constraint', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'T',
            constraint: { kind: 'intrinsic', intrinsic: 'string' },
            defaultValue: undefined,
          } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<T extends string>');
    });

    it('should format a type parameter with default value', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'T',
            constraint: undefined,
            defaultValue: { kind: 'intrinsic', intrinsic: 'string' },
          } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<T = string>');
    });

    it('should format a type parameter with constraint and default', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'T',
            constraint: {
              kind: 'object',
              typeName: { name: 'Record', typeArguments: undefined },
              properties: [],
            },
            defaultValue: { kind: 'intrinsic', intrinsic: 'unknown' },
          } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<T extends Record = unknown>');
    });

    it('should format multiple type parameters', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'K',
            constraint: undefined,
            defaultValue: undefined,
          } as any,
          equalToDefault: false,
        },
        {
          type: {
            kind: 'typeParameter',
            name: 'V',
            constraint: undefined,
            defaultValue: undefined,
          } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<K, V>');
    });

    it('should skip concrete type arguments and only include type parameters', () => {
      const args: tae.TypeArgument[] = [
        {
          type: {
            kind: 'typeParameter',
            name: 'T',
            constraint: undefined,
            defaultValue: undefined,
          } as any,
          equalToDefault: false,
        },
        {
          type: { kind: 'intrinsic', intrinsic: 'string' } as any,
          equalToDefault: false,
        },
      ];
      expect(formatTypeParameterDeclaration(args)).toBe('<T>');
    });
  });

  describe('extractTypeParameters', () => {
    it('should return empty string for types without typeName', () => {
      const type = { kind: 'intrinsic', intrinsic: 'string' } as tae.AnyType;
      expect(extractTypeParameters(type)).toBe('');
    });

    it('should return empty string for types with typeName but no typeArguments', () => {
      const type = {
        kind: 'object',
        typeName: { name: 'Foo' },
        properties: [],
      } as any;
      expect(extractTypeParameters(type)).toBe('');
    });

    it('should extract type parameters from an object type', () => {
      const type = {
        kind: 'object',
        typeName: {
          name: 'Container',
          typeArguments: [
            {
              type: {
                kind: 'typeParameter',
                name: 'T',
                constraint: undefined,
                defaultValue: undefined,
              },
              equalToDefault: false,
            },
          ],
        },
        properties: [],
      } as any;
      expect(extractTypeParameters(type)).toBe('<T>');
    });

    it('should extract type parameters from a union type', () => {
      const type = {
        kind: 'union',
        typeName: {
          name: 'Result',
          typeArguments: [
            {
              type: {
                kind: 'typeParameter',
                name: 'T',
                constraint: undefined,
                defaultValue: undefined,
              },
              equalToDefault: false,
            },
            {
              type: {
                kind: 'typeParameter',
                name: 'E',
                constraint: undefined,
                defaultValue: undefined,
              },
              equalToDefault: false,
            },
          ],
        },
        types: [],
      } as any;
      expect(extractTypeParameters(type)).toBe('<T, E>');
    });
  });
});

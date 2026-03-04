import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatRawData, formatReExportData, isRawType } from './formatRaw';
import { buildTypeCompatibilityMap, type TypeRewriteContext } from './format';

/** Default rewrite context for testing - empty map and empty export names */
const defaultRewriteContext: TypeRewriteContext = {
  typeCompatibilityMap: new Map(),
  exportNames: [],
};

/**
 * Creates a rewrite context with specific export names.
 */
function createRewriteContext(
  exportNames: string[],
  allExports: tae.ExportNode[] = [],
  typeNameMap?: Record<string, string>,
): TypeRewriteContext {
  return {
    typeCompatibilityMap: buildTypeCompatibilityMap(allExports, exportNames),
    exportNames,
    typeNameMap,
  };
}

/**
 * Helper to create a mock ExportNode for type alias types.
 */
function createTypeAliasExport(
  name: string,
  typeText: string,
  documentation?: { description?: string },
): tae.ExportNode {
  return {
    name,
    type: {
      kind: 'typeAlias',
      typeText,
    },
    documentation,
  } as any;
}

/**
 * Helper to create a mock ExportNode for enum types.
 */
function createEnumExport(
  name: string,
  members: Array<{
    name: string;
    value?: string | number;
    documentation?: { description?: string };
  }>,
  documentation?: { description?: string },
): tae.ExportNode {
  return {
    name,
    type: {
      kind: 'enum',
      members: members.map((m) => ({
        name: m.name,
        value: m.value,
        documentation: m.documentation,
      })),
    },
    documentation,
  } as any;
}

/**
 * Helper to create a mock PropertyNode for use in object exports.
 */
function createProperty(
  name: string,
  type: Record<string, unknown>,
  options?: {
    optional?: boolean;
    description?: string;
    defaultValue?: unknown;
    tags?: Array<{ name: string; value: string | undefined }>;
  },
): Record<string, unknown> {
  const documentation =
    options?.description || options?.defaultValue !== undefined || options?.tags
      ? {
          description: options.description,
          defaultValue: options.defaultValue,
          tags: options.tags ?? [],
        }
      : undefined;

  return {
    name,
    type,
    optional: options?.optional ?? false,
    documentation,
  };
}

/**
 * Helper to create a mock ExportNode for object types (interfaces).
 */
function createObjectExport(
  name: string,
  properties: Array<Record<string, unknown>>,
  documentation?: { description?: string },
): tae.ExportNode {
  return {
    name,
    type: {
      kind: 'object',
      typeName: undefined,
      properties,
    },
    documentation,
  } as any;
}

describe('formatRaw', () => {
  describe('isRawType', () => {
    it('should return true when not a component, hook, or function', () => {
      expect(isRawType({} as any, false, false, false)).toBe(true);
    });

    it('should return false when isComponent is true', () => {
      expect(isRawType({} as any, true, false, false)).toBe(false);
    });

    it('should return false when isHook is true', () => {
      expect(isRawType({} as any, false, true, false)).toBe(false);
    });

    it('should return false when isFunction is true', () => {
      expect(isRawType({} as any, false, false, true)).toBe(false);
    });
  });

  describe('formatRawData', () => {
    describe('basic type aliases', () => {
      it('should format a simple type alias', async () => {
        const result = await formatRawData(
          createTypeAliasExport('ButtonState', '{ disabled: boolean }'),
          'Button.State',
          {},
          defaultRewriteContext,
        );

        expect(result.name).toBe('Button.State');
        expect(result.formattedCode).toContain('type ButtonState');
        expect(result.formattedCode).toContain('disabled: boolean');
      });

      it('should include description when provided', async () => {
        const result = await formatRawData(
          createTypeAliasExport('ButtonState', '{ disabled: boolean }', {
            description: 'The state of the button',
          }),
          'Button.State',
          {},
          defaultRewriteContext,
        );

        expect(result.descriptionText).toBe('The state of the button');
        expect(result.description).toBeDefined();
        expect(result.description?.type).toBe('root');
      });

      it('should generate originalTypeName by removing dots from displayName', async () => {
        const result = await formatRawData(
          createTypeAliasExport('State', '{ open: boolean }'),
          'Toolbar.Root.State',
          {},
          defaultRewriteContext,
        );

        // The formatted code should use ToolbarRootState, not State or Toolbar.Root.State
        expect(result.formattedCode).toContain('type ToolbarRootState');
        expect(result.formattedCode).not.toContain('type State');
        expect(result.formattedCode).not.toContain('type Toolbar.Root.State');
      });
    });

    describe('DataAttributes types', () => {
      it('should detect DataAttributes types and set dataAttributesOf', async () => {
        const result = await formatRawData(
          createTypeAliasExport('ButtonDataAttributes', '{ "data-disabled": boolean }'),
          'Button.DataAttributes',
          {},
          defaultRewriteContext,
        );

        expect(result.name).toBe('Button.DataAttributes');
        expect(result.dataAttributesOf).toBe('Button');
        expect(result.reExportOf).toBeUndefined();
        expect(result.cssVarsOf).toBeUndefined();
      });
    });

    describe('CssVars types', () => {
      it('should detect CssVars types and set cssVarsOf', async () => {
        const result = await formatRawData(
          createTypeAliasExport('SliderCssVars', '{ "--slider-track-color": string }'),
          'Slider.CssVars',
          {},
          defaultRewriteContext,
        );

        expect(result.name).toBe('Slider.CssVars');
        expect(result.cssVarsOf).toBe('Slider');
        expect(result.dataAttributesOf).toBeUndefined();
        expect(result.reExportOf).toBeUndefined();
      });
    });

    describe('enum types', () => {
      it('should format enum types with members', async () => {
        const result = await formatRawData(
          createEnumExport('Direction', [
            { name: 'Up', value: 'up' },
            { name: 'Down', value: 'down' },
            { name: 'Left', value: 'left' },
            { name: 'Right', value: 'right' },
          ]),
          'Direction',
          {},
          defaultRewriteContext,
        );

        expect(result.name).toBe('Direction');
        expect(result.enumMembers).toBeDefined();
        expect(result.enumMembers).toHaveLength(4);
        expect(result.enumMembers?.[0].name).toBe('Up');
        expect(result.enumMembers?.[0].value).toBe('up');
      });

      it('should include enum member descriptions', async () => {
        const result = await formatRawData(
          createEnumExport('Status', [
            { name: 'Active', value: 1, documentation: { description: 'The item is active' } },
            { name: 'Inactive', value: 0, documentation: { description: 'The item is inactive' } },
          ]),
          'Status',
          {},
          defaultRewriteContext,
        );

        expect(result.enumMembers?.[0].descriptionText).toBe('The item is active');
        expect(result.enumMembers?.[0].description).toBeDefined();
        expect(result.enumMembers?.[1].descriptionText).toBe('The item is inactive');
      });
    });

    describe('type name rewriting', () => {
      it('should NOT rewrite formattedCode (preserves valid TypeScript syntax)', async () => {
        const rewriteContext = createRewriteContext(['ButtonState', 'Button.State'], [], {
          ButtonState: 'Button.State',
        });

        const result = await formatRawData(
          createTypeAliasExport('ButtonState', '{ disabled: boolean }'),
          'Button.State',
          { ButtonState: 'Button.State' },
          rewriteContext,
        );

        // formattedCode should still use ButtonState, not Button.State
        expect(result.formattedCode).toContain('type ButtonState');
        expect(result.formattedCode).not.toContain('type Button.State');
      });

      it('should rewrite type references in descriptionText', async () => {
        const rewriteContext = createRewriteContext(['InputState', 'Input.State'], [], {
          InputState: 'Input.State',
        });

        const result = await formatRawData(
          createTypeAliasExport('InputValue', 'string', {
            description: 'The value stored in InputState',
          }),
          'Input.Value',
          { InputState: 'Input.State' },
          rewriteContext,
        );

        // descriptionText should be rewritten
        expect(result.descriptionText).toContain('Input.State');
      });
    });

    describe('object types with property comments', () => {
      it('should include a JSDoc comment for a property with a description', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty(
              'enabled',
              { kind: 'intrinsic', intrinsic: 'boolean' },
              {
                optional: true,
                description: 'Whether the feature is turned on',
              },
            ),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toContain('/** Whether the feature is turned on */');
        expect(result.formattedCode).toContain('enabled?:');
      });

      it('should not add a comment when the property has no documentation', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty('enabled', { kind: 'intrinsic', intrinsic: 'boolean' }),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).not.toContain('/**');
        expect(result.formattedCode).toContain('enabled:');
      });

      it('should include all JSDoc tags in the comment', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty(
              'mode',
              { kind: 'intrinsic', intrinsic: 'string' },
              {
                description: 'The rendering mode',
                tags: [
                  { name: 'see', value: 'https://example.com/modes' },
                  { name: 'deprecated', value: 'Use renderMode instead' },
                ],
              },
            ),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toContain('The rendering mode');
        expect(result.formattedCode).toContain('@see https://example.com/modes');
        expect(result.formattedCode).toContain('@deprecated Use renderMode instead');
      });

      it('should include tags without values', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty(
              'oldProp',
              { kind: 'intrinsic', intrinsic: 'string' },
              {
                optional: true,
                tags: [{ name: 'deprecated', value: undefined }],
              },
            ),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toContain('@deprecated');
      });

      it('should prefix continuation lines of multi-line tag values', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty(
              'template',
              { kind: 'intrinsic', intrinsic: 'string' },
              {
                optional: true,
                description: 'Custom template function',
                tags: [
                  {
                    name: 'example',
                    value: 'template: (a, b) =>\n  renderHtml(a, b)',
                  },
                ],
              },
            ),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        // Every line inside the JSDoc block must start with ` * `
        const lines = result.formattedCode.split('\n');
        const jsdocLines = lines.filter(
          (l: string) => !l.includes('/**') && !l.includes('*/') && l.trimStart().startsWith('*'),
        );
        for (const line of jsdocLines) {
          expect(line.trimStart()).toMatch(/^\* /);
        }
        expect(result.formattedCode).toContain('* @example');
        expect(result.formattedCode).toContain('* template: (a, b) =>');
        expect(result.formattedCode).toContain('*   renderHtml(a, b)');
      });

      it('should include @default values in the comment', async () => {
        const result = await formatRawData(
          createObjectExport('Config', [
            createProperty(
              'timeout',
              { kind: 'intrinsic', intrinsic: 'number' },
              {
                optional: true,
                description: 'Request timeout in milliseconds',
                defaultValue: 3000,
              },
            ),
          ]),
          'Config',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toContain('Request timeout in milliseconds');
        expect(result.formattedCode).toContain('@default 3000');
      });

      it('should include comments for multiple properties', async () => {
        const result = await formatRawData(
          createObjectExport('Options', [
            createProperty(
              'label',
              { kind: 'intrinsic', intrinsic: 'string' },
              {
                description: 'Display text',
              },
            ),
            createProperty(
              'disabled',
              { kind: 'intrinsic', intrinsic: 'boolean' },
              {
                optional: true,
                description: 'Prevents interaction',
              },
            ),
          ]),
          'Options',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toMatchInlineSnapshot(`
          "type Options = {
            /** Display text */
            label: string;
            /** Prevents interaction */
            disabled?: boolean;
          };"
        `);
      });

      it('should include comments for nested anonymous object properties', async () => {
        const result = await formatRawData(
          createObjectExport('Settings', [
            createProperty(
              'appearance',
              {
                kind: 'object',
                typeName: undefined,
                properties: [
                  createProperty(
                    'theme',
                    { kind: 'intrinsic', intrinsic: 'string' },
                    {
                      description: 'Color scheme name',
                    },
                  ),
                ],
              },
              {
                description: 'Visual configuration',
              },
            ),
          ]),
          'Settings',
          {},
          defaultRewriteContext,
        );

        expect(result.formattedCode).toMatchInlineSnapshot(`
          "type Settings = {
            /** Visual configuration */
            appearance: {
              /** Color scheme name */
              theme: string;
            };
          };"
        `);
      });

      it('should place comments on their own line after undocumented properties', async () => {
        // Reproduces the bug where intersection-merged properties have
        // comments placed inline after semicolons instead of on their own line.
        // BaseContentLoadingProps = ContentLoadingVariant & CodeIdentityProps & { ... }
        // where ContentLoadingVariant has undocumented properties and
        // CodeIdentityProps has documented properties (name, slug, url).
        const result = await formatRawData(
          {
            name: 'ContentProps',
            type: {
              kind: 'intersection',
              typeName: { name: 'ContentProps' },
              types: [
                {
                  kind: 'object',
                  typeName: undefined,
                  properties: [
                    createProperty(
                      'source',
                      { kind: 'external', typeName: { name: 'React.ReactNode' } },
                      { optional: true },
                    ),
                    createProperty(
                      'extraSource',
                      {
                        kind: 'object',
                        typeName: undefined,
                        properties: [],
                        indexSignature: {
                          keyName: 'fileName',
                          keyType: 'string',
                          valueType: { kind: 'external', typeName: { name: 'React.ReactNode' } },
                        },
                      },
                      { optional: true },
                    ),
                  ],
                },
                {
                  kind: 'object',
                  typeName: undefined,
                  properties: [
                    createProperty(
                      'name',
                      { kind: 'intrinsic', intrinsic: 'string' },
                      { optional: true, description: 'Display name for the code example' },
                    ),
                    createProperty(
                      'slug',
                      { kind: 'intrinsic', intrinsic: 'string' },
                      { optional: true, description: 'URL-friendly identifier for linking' },
                    ),
                  ],
                },
              ],
            },
          } as any,
          'ContentProps',
          {},
          defaultRewriteContext,
        );

        // Each comment must appear on its own line, not inline after a semicolon
        const lines = result.formattedCode.split('\n');
        for (const line of lines) {
          // A line should not have code followed by a JSDoc comment
          // e.g. "}; /** Display name */" is wrong
          expect(line).not.toMatch(/;\s*\/\*\*/);
        }
      });
    });
  });

  describe('formatReExportData', () => {
    it('should format re-export data with reExportOf field', async () => {
      const result = await formatReExportData(
        createTypeAliasExport('ButtonProps', 'ButtonRootProps'),
        'Button.Props',
        { name: 'Button', slug: '#button', suffix: 'props' },
        {},
        defaultRewriteContext,
      );

      expect(result.name).toBe('Button.Props');
      expect(result.reExportOf).toEqual({ name: 'Button', slug: '#button', suffix: 'props' });
      expect(result.formattedCode).toBeDefined();
    });

    it('should include description when provided', async () => {
      const result = await formatReExportData(
        createTypeAliasExport('ButtonProps', 'ButtonRootProps', {
          description: 'Props for the Button component',
        }),
        'Button.Props',
        { name: 'Button', slug: '#button', suffix: 'props' },
        {},
        defaultRewriteContext,
      );

      expect(result.descriptionText).toBe('Props for the Button component');
      expect(result.description).toBeDefined();
    });

    it('should NOT rewrite formattedCode for re-exports', async () => {
      const rewriteContext = createRewriteContext(['ButtonRootProps', 'Button.Root.Props'], [], {
        ButtonRootProps: 'Button.Root.Props',
      });

      const result = await formatReExportData(
        createTypeAliasExport('ButtonProps', 'ButtonRootProps'),
        'Button.Props',
        { name: 'Button', slug: '#button', suffix: 'props' },
        { ButtonRootProps: 'Button.Root.Props' },
        rewriteContext,
      );

      // formattedCode should use the flat name ButtonProps
      expect(result.formattedCode).toContain('type ButtonProps');
      expect(result.formattedCode).not.toContain('type Button.Props');
    });
  });
});

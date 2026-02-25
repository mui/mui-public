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

import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { formatComponentData, isPublicComponent } from './formatComponent';
import { buildTypeCompatibilityMap, type TypeRewriteContext } from './format';

/** Default rewrite context for testing - empty map and empty export names */
const defaultRewriteContext: TypeRewriteContext = {
  typeCompatibilityMap: new Map(),
  exportNames: [],
};

/**
 * Creates a rewrite context with specific export names.
 * Optionally accepts allExports to build the type compatibility map.
 */
function createRewriteContext(
  exportNames: string[],
  allExports: tae.ExportNode[] = [],
): TypeRewriteContext {
  return {
    typeCompatibilityMap: buildTypeCompatibilityMap(allExports, exportNames),
    exportNames,
  };
}

describe('formatComponent', () => {
  describe('isPublicComponent', () => {
    it('should reject non-ComponentNode types', () => {
      expect(
        isPublicComponent({
          type: { kind: 'function' },
          isPublic: () => true,
        } as any),
      ).toBe(false);
    });

    it('should reject components with @ignore tag', () => {
      // Tests the @ignore tag filtering logic. The type instanceof check is bypassed
      // by using a plain object mock, focusing on the documentation tag validation.
      expect(
        isPublicComponent({
          type: { kind: 'component' },
          documentation: {
            tags: [{ name: 'ignore', value: undefined }],
          },
        } as any),
      ).toBe(false);
    });

    it('should reject non-public components', () => {
      expect(
        isPublicComponent({
          type: { kind: 'component' },
          documentation: {
            visibility: 'internal',
            tags: [],
          },
        } as any),
      ).toBe(false);
    });
  });

  describe('formatComponentData', () => {
    it('should format basic component metadata including name and description', async () => {
      const result = await formatComponentData(
        {
          name: 'Button',
          type: { kind: 'component', props: [] },
          documentation: { description: 'A button' },
        } as any,
        [],
        {},
        defaultRewriteContext,
      );

      expect(result.name).toBe('Button');
      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'A button' }],
          },
        ],
      });
    });

    it('should remove documentation URL suffix from description', async () => {
      const result = await formatComponentData(
        {
          name: 'Input',
          type: { kind: 'component', props: [] },
          documentation: { description: 'Input\n\nDocumentation: url' },
        } as any,
        [],
        {},
        defaultRewriteContext,
      );

      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Input' }],
          },
        ],
      });
    });

    it('should find data attributes by suffix', async () => {
      const result = await formatComponentData(
        { name: 'Checkbox', type: { kind: 'component', props: [] } } as any,
        [
          {
            name: 'CheckboxDataAttributes',
            type: {
              kind: 'enum',
              members: [{ value: 'data-checked', documentation: { description: 'Checked' } }],
            },
          },
        ] as any,
        {},
        defaultRewriteContext,
      );

      expect(result.dataAttributes['data-checked'].type).toBeUndefined();
      expect(result.dataAttributes['data-checked'].description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Checked' }],
          },
        ],
      });
    });

    it('should find CSS variables by suffix', async () => {
      const result = await formatComponentData(
        { name: 'Slider', type: { kind: 'component', props: [] } } as any,
        [
          {
            name: 'SliderCssVars',
            type: {
              kind: 'enum',
              members: [
                {
                  value: '--color',
                  documentation: { description: 'Color', tags: [{ name: 'type', value: 'color' }] },
                },
              ],
            },
          },
        ] as any,
        {},
        defaultRewriteContext,
      );

      expect(result.cssVariables['--color'].type).toBe('color');
      expect(result.cssVariables['--color'].description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Color' }],
          },
        ],
      });
    });

    it('should rewrite .RootInternal to .Root', async () => {
      const result = await formatComponentData(
        {
          name: 'Button',
          type: {
            kind: 'component',
            props: [
              {
                name: 'className',
                type: { kind: 'literal', value: '"Button.RootInternal"' },
                optional: true,
                documentation: {},
              },
            ],
          },
        } as any,
        [],
        {},
        defaultRewriteContext,
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Button.Root');
      expect(json).not.toContain('RootInternal');
    });

    it('should rewrite Combobox to Autocomplete for Autocomplete', async () => {
      const component = {
        name: 'Autocomplete',
        inheritedFrom: 'Combobox',
        type: {
          kind: 'component',
          props: [
            {
              name: 'className',
              type: { kind: 'literal', value: '"Combobox.Root"' },
              optional: true,
              documentation: {},
            },
          ],
        },
      } as any;
      // The Root export has extendsTypes pointing back to Combobox.Root
      const rootExport = {
        name: 'Autocomplete.Root',
        extendsTypes: [{ name: 'Combobox.Root', resolvedName: 'ComboboxRoot' }],
        type: { kind: 'interface', properties: [] },
      } as any;
      const exportNames = ['Autocomplete.Root'];
      const result = await formatComponentData(
        component,
        [],
        {},
        createRewriteContext(exportNames, [component, rootExport]),
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Autocomplete.');
      expect(json).not.toContain('Combobox.');
    });

    it('should rewrite inherited namespace types to current namespace (dotted format)', async () => {
      // Simulates AlertDialog.Trigger which inherits from DialogTrigger
      // DialogTrigger.State should become AlertDialog.Trigger.State
      const component = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'DialogTrigger',
        type: {
          kind: 'component',
          props: [
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
                        parameters: [
                          {
                            name: 'state',
                            type: {
                              kind: 'external',
                              typeName: { name: 'DialogTrigger.State' },
                            },
                          },
                        ],
                        returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                      },
                    ],
                  },
                ],
              },
              optional: true,
              documentation: { description: 'CSS class' },
            },
          ],
        },
      } as any;
      // The State export has extendsTypes pointing back to the original Dialog types
      const stateExport = {
        name: 'AlertDialog.Trigger.State',
        extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
        type: { kind: 'interface', properties: [] },
      } as any;
      const exportNames = [
        'AlertDialog.Trigger',
        'AlertDialog.Trigger.State',
        'AlertDialog.Trigger.Props',
      ];
      const result = await formatComponentData(
        component,
        [],
        {},
        createRewriteContext(exportNames, [component, stateExport]),
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTrigger.State with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT contain the original Dialog namespace
      expect(json).not.toContain('DialogTrigger.State');
    });

    it('should rewrite inherited namespace types to current namespace (flat format)', async () => {
      // Simulates AlertDialog.Trigger which inherits from DialogTrigger
      // DialogTriggerState (flat) should become AlertDialog.Trigger.State (dotted)
      const component = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'DialogTrigger',
        type: {
          kind: 'component',
          props: [
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
                        parameters: [
                          {
                            name: 'state',
                            type: {
                              kind: 'external',
                              // Flat format: no dots
                              typeName: { name: 'DialogTriggerState' },
                            },
                          },
                        ],
                        returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                      },
                    ],
                  },
                ],
              },
              optional: true,
              documentation: { description: 'CSS class' },
            },
          ],
        },
      } as any;
      // The State export has extendsTypes pointing back to the original Dialog types
      const stateExport = {
        name: 'AlertDialog.Trigger.State',
        extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
        type: { kind: 'interface', properties: [] },
      } as any;
      const exportNames = [
        'AlertDialog.Trigger',
        'AlertDialog.Trigger.State',
        'AlertDialog.Trigger.Props',
      ];
      const result = await formatComponentData(
        component,
        [],
        {},
        createRewriteContext(exportNames, [component, stateExport]),
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTriggerState with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT contain the original flat format
      expect(json).not.toContain('DialogTriggerState');
    });

    it('should inherit inheritedFrom from parent component for nested types', async () => {
      // Simulates AlertDialog.Trigger.State which is a nested type
      // The parent AlertDialog.Trigger has inheritedFrom: 'DialogTrigger'
      // AlertDialog.Trigger.State has extendsTypes pointing to DialogTrigger.State
      // So types like DialogTrigger.State should become AlertDialog.Trigger.State
      const parentComponent = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'DialogTrigger',
        type: { kind: 'component', props: [] },
      } as any;

      const component = {
        name: 'AlertDialog.Trigger.State',
        // extendsTypes tells us what Dialog types map to this export
        extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
        type: {
          kind: 'component',
          props: [
            {
              name: 'renderProp',
              type: {
                kind: 'function',
                callSignatures: [
                  {
                    parameters: [
                      {
                        name: 'state',
                        type: {
                          kind: 'external',
                          typeName: { name: 'DialogTrigger.State' },
                        },
                      },
                    ],
                    returnValueType: { kind: 'intrinsic', intrinsic: 'void' },
                  },
                ],
              },
              optional: false,
              documentation: { description: 'Render callback' },
            },
          ],
        },
      } as any;
      const exportNames = [
        'AlertDialog.Trigger',
        'AlertDialog.Trigger.State',
        'AlertDialog.Trigger.Props',
      ];
      const result = await formatComponentData(
        component,
        [parentComponent], // allExports contains the parent
        {},
        createRewriteContext(exportNames, [parentComponent, component]),
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTrigger.State with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      expect(json).not.toContain('DialogTrigger.State');
    });

    it('should not double-replace when componentGroup contains inheritedFrom', async () => {
      // This tests that "DialogTrigger" doesn't get partially matched
      // e.g., DialogTrigger.State -> AlertDialog.Trigger.State should NOT become AlertAlertDialog.Trigger.State
      const component = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'DialogTrigger',
        type: {
          kind: 'component',
          props: [
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
                        parameters: [
                          {
                            name: 'state',
                            type: {
                              kind: 'external',
                              // This format could cause double-replacement
                              typeName: { name: 'DialogTrigger.State' },
                            },
                          },
                        ],
                        returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                      },
                    ],
                  },
                ],
              },
              optional: true,
              documentation: { description: 'CSS class' },
            },
          ],
        },
      } as any;
      // The State export has extendsTypes pointing back to the original Dialog types
      const stateExport = {
        name: 'AlertDialog.Trigger.State',
        extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
        type: { kind: 'interface', properties: [] },
      } as any;
      const exportNames = [
        'AlertDialog.Trigger',
        'AlertDialog.Trigger.State',
        'AlertDialog.Trigger.Props',
      ];
      const result = await formatComponentData(
        component,
        [],
        {},
        createRewriteContext(exportNames, [component, stateExport]),
      );

      const json = JSON.stringify(result);
      // Should have correct replacement
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT have double replacement like "AlertAlertDialog"
      expect(json).not.toContain('AlertAlert');
      // The original "DialogTrigger.State" should be replaced
      expect(json).not.toContain('DialogTrigger.State');
    });

    it('should not replace type names when target export does not exist', async () => {
      // If AlertDialog.Trigger.State doesn't exist in exportNames,
      // DialogTriggerState should NOT be replaced
      const component = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'DialogTrigger',
        type: {
          kind: 'component',
          props: [
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
                        parameters: [
                          {
                            name: 'state',
                            type: {
                              kind: 'external',
                              typeName: { name: 'DialogTriggerState' },
                            },
                          },
                        ],
                        returnValueType: { kind: 'intrinsic', intrinsic: 'string' },
                      },
                    ],
                  },
                ],
              },
              optional: true,
              documentation: { description: 'CSS class' },
            },
          ],
        },
      } as any;
      // Note: AlertDialog.Trigger.State is NOT in the export names
      const exportNames = ['AlertDialog.Trigger', 'AlertDialog.Trigger.Props'];
      const result = await formatComponentData(
        component,
        [],
        {},
        createRewriteContext(exportNames, [component]),
      );

      const json = JSON.stringify(result);
      // Should keep the original type name since there's no matching export
      expect(json).toContain('DialogTriggerState');
      // Should NOT contain AlertDialog.Trigger.State since it doesn't exist
      expect(json).not.toContain('AlertDialog.Trigger.State');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { formatComponentData, isPublicComponent } from './formatComponent';

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
        [],
        {},
        {},
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
        [],
        {},
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
        [],
        {},
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
        [],
        {},
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
                name: 'ref',
                type: { kind: 'literal', value: '"Button.RootInternal"' },
                optional: true,
                documentation: {},
              },
            ],
          },
        } as any,
        [],
        [],
        {},
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Button.Root');
      expect(json).not.toContain('RootInternal');
    });

    it('should rewrite Combobox to Autocomplete for Autocomplete', async () => {
      const result = await formatComponentData(
        {
          name: 'Autocomplete',
          inheritedFrom: 'Combobox',
          type: {
            kind: 'component',
            props: [
              {
                name: 'ref',
                type: { kind: 'literal', value: '"Combobox.Root"' },
                optional: true,
                documentation: {},
              },
            ],
          },
        } as any,
        [],
        ['Autocomplete.Root'],
        {},
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Autocomplete.');
      expect(json).not.toContain('Combobox.');
    });

    it('should rewrite inherited namespace types to current namespace (dotted format)', async () => {
      // Simulates AlertDialog.Trigger which inherits from Dialog
      // DialogTrigger.State should become AlertDialog.Trigger.State
      const result = await formatComponentData(
        {
          name: 'AlertDialog.Trigger',
          inheritedFrom: 'Dialog',
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
        } as any,
        [],
        ['AlertDialog.Trigger', 'AlertDialog.Trigger.State', 'AlertDialog.Trigger.Props'],
        {},
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTrigger.State with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT contain the original Dialog namespace
      expect(json).not.toContain('DialogTrigger.State');
    });

    it('should rewrite inherited namespace types to current namespace (flat format)', async () => {
      // Simulates AlertDialog.Trigger which inherits from Dialog
      // DialogTriggerState (flat) should become AlertDialog.Trigger.State (dotted)
      const result = await formatComponentData(
        {
          name: 'AlertDialog.Trigger',
          inheritedFrom: 'Dialog',
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
        } as any,
        [],
        ['AlertDialog.Trigger', 'AlertDialog.Trigger.State', 'AlertDialog.Trigger.Props'],
        {},
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTriggerState with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT contain the original flat format
      expect(json).not.toContain('DialogTriggerState');
    });

    it('should inherit inheritedFrom from parent component for nested types', async () => {
      // Simulates AlertDialog.Trigger.State which is a nested type
      // The parent AlertDialog.Trigger has inheritedFrom: 'Dialog'
      // So types like DialogTrigger.State should become AlertDialog.Trigger.State
      const parentComponent = {
        name: 'AlertDialog.Trigger',
        inheritedFrom: 'Dialog',
        type: { kind: 'component', props: [] },
      };

      const result = await formatComponentData(
        {
          name: 'AlertDialog.Trigger.State',
          // No inheritedFrom on this export - but parent has it
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
        } as any,
        [parentComponent as any], // allExports contains the parent
        ['AlertDialog.Trigger', 'AlertDialog.Trigger.State', 'AlertDialog.Trigger.Props'],
        {},
      );

      const json = JSON.stringify(result);
      // Should have replaced DialogTrigger.State with AlertDialog.Trigger.State
      expect(json).toContain('AlertDialog.Trigger.State');
      expect(json).not.toContain('DialogTrigger.State');
    });

    it('should not double-replace when componentGroup contains inheritedFrom', async () => {
      // This tests that "Dialog" in "AlertDialog" doesn't cause re-replacement
      // e.g., Dialog.Trigger.State -> AlertDialog.Trigger.State should NOT become AlertAlertDialog.Trigger.State
      const result = await formatComponentData(
        {
          name: 'AlertDialog.Trigger',
          inheritedFrom: 'Dialog',
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
                                typeName: { name: 'Dialog.Trigger.State' },
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
        } as any,
        [],
        ['AlertDialog.Trigger', 'AlertDialog.Trigger.State', 'AlertDialog.Trigger.Props'],
        {},
      );

      const json = JSON.stringify(result);
      // Should have correct replacement
      expect(json).toContain('AlertDialog.Trigger.State');
      // Should NOT have double replacement like "AlertAlertDialog"
      expect(json).not.toContain('AlertAlert');
      // The original "Dialog.Trigger.State" should be replaced (not appear standalone)
      // Note: "AlertDialog.Trigger.State" contains "Dialog.Trigger.State" as a substring,
      // so we check that it doesn't appear with a word boundary before it
      expect(json).not.toMatch(/[^t]Dialog\.Trigger\.State/); // "t" from "Alert"
    });

    it('should not replace type names when target export does not exist', async () => {
      // If AlertDialog.Trigger.State doesn't exist in exportNames,
      // DialogTriggerState should NOT be replaced
      const result = await formatComponentData(
        {
          name: 'AlertDialog.Trigger',
          inheritedFrom: 'Dialog',
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
        } as any,
        [],
        // Note: AlertDialog.Trigger.State is NOT in the export names
        ['AlertDialog.Trigger', 'AlertDialog.Trigger.Props'],
        {},
      );

      const json = JSON.stringify(result);
      // Should keep the original type name since there's no matching export
      expect(json).toContain('DialogTriggerState');
      // Should NOT contain AlertDialog.Trigger.State since it doesn't exist
      expect(json).not.toContain('AlertDialog.Trigger.State');
    });
  });
});

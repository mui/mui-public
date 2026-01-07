import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import type { ExportNode } from 'typescript-api-extractor';
import { enhanceCodeTypes } from './enhanceCodeTypes';
import type { TypesMeta } from '../syncTypes/syncTypes';
import type { ComponentTypeMeta } from '../syncTypes/formatComponent';
import type { HookTypeMeta } from '../syncTypes/formatHook';
import { getHastTextContent } from './hastTypeUtils';

/**
 * Helper to check if an enhanced property has the expected fields
 */
function hasEnhancedFields(prop: any): boolean {
  return (
    prop.type !== undefined &&
    typeof prop.type === 'object' &&
    prop.type.type === 'root' &&
    Array.isArray(prop.type.children)
  );
}

/**
 * Helper to extract text from HAST
 */
function extractText(hast: HastRoot): string {
  return getHastTextContent(hast);
}

describe('enhanceCodeTypes', () => {
  describe('component types', () => {
    it('should enhance component props with HAST type field', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  disabled: {
                    typeText: 'boolean',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const component = result.Default.types[0];
      expect(component.type).toBe('component');
      if (component.type === 'component') {
        expect(hasEnhancedFields(component.data.props.disabled)).toBe(true);
        expect(extractText(component.data.props.disabled.type)).toBe('boolean');
      }
    });

    it('should generate shortType for union types', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  variant: {
                    typeText: '"primary" | "secondary" | "tertiary" | "quaternary"',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;
        expect(prop.shortType).toBeDefined();
        expect(prop.shortTypeText).toBe('Union');
        expect(extractText(prop.shortType!)).toBe('Union');
      }
    });

    it('should generate shortType "function" for event handlers', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  onClick: {
                    typeText: '(event: MouseEvent) => void',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.onClick;
        expect(prop.shortType).toBeDefined();
        expect(prop.shortTypeText).toBe('function');
      }
    });

    it('should enhance default values with HAST', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  variant: {
                    typeText: '"primary" | "secondary"',
                    defaultText: '"primary"',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;
        expect(prop.default).toBeDefined();
        expect(extractText(prop.default!)).toBe('"primary"');
      }
    });

    it('should NOT generate shortType for simple types', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  label: {
                    typeText: 'string',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.label;
        expect(prop.shortType).toBeUndefined();
        expect(prop.shortTypeText).toBeUndefined();
      }
    });
  });

  describe('hook types', () => {
    it('should enhance hook parameters with HAST type field', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'hook',
              name: 'useCounter',
              data: {
                name: 'useCounter',
                parameters: {
                  initialValue: {
                    typeText: 'number',
                  },
                },
                returnValue: 'number',
              } as HookTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const hook = result.Default.types[0];
      expect(hook.type).toBe('hook');
      if (hook.type === 'hook') {
        expect(hasEnhancedFields(hook.data.parameters.initialValue)).toBe(true);
        expect(extractText(hook.data.parameters.initialValue.type)).toBe('number');
      }
    });

    it('should convert string returnValue to HAST', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'hook',
              name: 'useCounter',
              data: {
                name: 'useCounter',
                parameters: {},
                returnValue: 'number',
              } as HookTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const hook = result.Default.types[0];
      if (hook.type === 'hook') {
        // returnValue should be a HastRoot when original was string
        expect((hook.data.returnValue as HastRoot).type).toBe('root');
        expect(extractText(hook.data.returnValue as HastRoot)).toBe('number');
      }
    });

    it('should enhance object returnValue properties with HAST', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'hook',
              name: 'useCounter',
              data: {
                name: 'useCounter',
                parameters: {},
                returnValue: {
                  count: {
                    typeText: 'number',
                  },
                  increment: {
                    typeText: '() => void',
                  },
                },
              } as HookTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const hook = result.Default.types[0];
      if (hook.type === 'hook') {
        const returnValue = hook.data.returnValue as Record<string, any>;
        expect(hasEnhancedFields(returnValue.count)).toBe(true);
        expect(extractText(returnValue.count.type)).toBe('number');
        expect(hasEnhancedFields(returnValue.increment)).toBe(true);
        expect(extractText(returnValue.increment.type)).toBe('() => void');
      }
    });

    it('should generate shortType for function return values', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'hook',
              name: 'useCounter',
              data: {
                name: 'useCounter',
                parameters: {},
                returnValue: {
                  increment: {
                    typeText: '() => void',
                  },
                },
              } as HookTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const hook = result.Default.types[0];
      if (hook.type === 'hook') {
        const returnValue = hook.data.returnValue as Record<string, any>;
        expect(returnValue.increment.shortType).toBeDefined();
        expect(returnValue.increment.shortTypeText).toBe('function');
      }
    });
  });

  describe('other types', () => {
    it('should pass through other types unchanged', async () => {
      const mockExportNode = { name: 'ButtonProps' } as ExportNode;
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'other',
              name: 'ButtonProps',
              data: mockExportNode,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      const other = result.Default.types[0];
      expect(other.type).toBe('other');
      expect(other.name).toBe('ButtonProps');
      expect((other as any).data).toBe(mockExportNode);
    });
  });

  describe('multiple variants', () => {
    it('should enhance all variants', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  disabled: { typeText: 'boolean' },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
        Secondary: {
          types: [
            {
              type: 'component',
              name: 'Input',
              data: {
                name: 'Input',
                props: {
                  value: { typeText: 'string' },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await enhanceCodeTypes(variantData);

      // Check Default variant
      const button = result.Default.types[0];
      if (button.type === 'component') {
        expect(hasEnhancedFields(button.data.props.disabled)).toBe(true);
      }

      // Check Secondary variant
      const input = result.Secondary.types[0];
      if (input.type === 'component') {
        expect(hasEnhancedFields(input.data.props.value)).toBe(true);
      }
    });
  });

  describe('formatting options', () => {
    it('should respect shortTypeUnionPrintWidth for multiline unions', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {
                  variant: {
                    typeText: '"primary" | "secondary" | "tertiary"',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      // Use very small width to force multiline
      const result = await enhanceCodeTypes(variantData, {
        formatting: { shortTypeUnionPrintWidth: 5 },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        // shortType should still be "Union"
        expect(component.data.props.variant.shortTypeText).toBe('Union');
      }
    });
  });

  describe('preserves typeNameMap', () => {
    it('should preserve typeNameMap in enhanced result', async () => {
      const variantData: Record<
        string,
        { types: TypesMeta[]; typeNameMap?: Record<string, string> }
      > = {
        Default: {
          types: [
            {
              type: 'component',
              name: 'Button',
              data: {
                name: 'Button',
                props: {},
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
          typeNameMap: {
            ButtonState: 'Button.State',
          },
        },
      };

      const result = await enhanceCodeTypes(variantData);

      expect(result.Default.typeNameMap).toEqual({ ButtonState: 'Button.State' });
    });
  });
});

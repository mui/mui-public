import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { highlightTypesMeta } from './highlightTypesMeta';
import type {
  TypesMeta,
  ComponentTypeMeta,
  HookTypeMeta,
  FunctionTypeMeta,
} from '../loadServerTypesMeta';
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

/**
 * Helper to create a minimal highlighted HAST for testing type expansion.
 * Creates a simple structure that represents a highlighted type reference.
 * Note: This mock replaces the reference with the same text, so detailedType
 * will be undefined (no actual expansion).
 */
function createMockHighlightedExport(typeName: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['pl-en'] },
            children: [{ type: 'text', value: typeName }],
          },
        ],
      },
    ],
  };
}

/**
 * Helper to create a mock that expands to different text.
 * This simulates replacing a type reference with its actual definition.
 */
function createExpandingMockExport(expandedText: string): HastRoot {
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [{ type: 'text', value: expandedText }],
      },
    ],
  };
}

describe('highlightTypesMeta', () => {
  describe('component types', () => {
    it('should enhance component props with HAST type field', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      const component = result[0];
      expect(component.type).toBe('component');
      if (component.type === 'component') {
        expect(hasEnhancedFields(component.data.props.disabled)).toBe(true);
        expect(extractText(component.data.props.disabled.type)).toBe('boolean');
      }
    });

    it('should enhance default values with HAST', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;
        expect(extractText(prop.default!)).toBe('"primary"');
      }
    });
  });

  describe('hook types', () => {
    it('should enhance hook parameters with HAST type field', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      const hook = result[0];
      expect(hook.type).toBe('hook');
      if (hook.type === 'hook') {
        expect(hasEnhancedFields(hook.data.parameters!.initialValue)).toBe(true);
        expect(extractText(hook.data.parameters!.initialValue.type)).toBe('number');
      }
    });

    it('should convert string returnValue to HAST', async () => {
      const types: TypesMeta[] = [
        {
          type: 'hook',
          name: 'useCounter',
          data: {
            name: 'useCounter',
            parameters: {},
            returnValue: 'number',
          } as HookTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);

      const hook = result[0];
      if (hook.type === 'hook') {
        // returnValue should be a HastRoot when original was string
        expect((hook.data.returnValue as HastRoot).type).toBe('root');
        expect(extractText(hook.data.returnValue as HastRoot)).toBe('number');
      }
    });

    it('should enhance object returnValue properties with HAST', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      const hook = result[0];
      if (hook.type === 'hook') {
        const returnValue = hook.data.returnValue as Record<string, any>;
        expect(hasEnhancedFields(returnValue.count)).toBe(true);
        expect(extractText(returnValue.count.type)).toBe('number');
        expect(hasEnhancedFields(returnValue.increment)).toBe(true);
        expect(extractText(returnValue.increment.type)).toBe('() => void');
      }
    });

    it('should expand single parameter with matching rawTypeProperties', async () => {
      const types: TypesMeta[] = [
        {
          type: 'hook',
          name: 'useFilter',
          data: {
            name: 'useFilter',
            parameters: {
              options: {
                typeText: 'FilterOptions',
                optional: true,
              },
            },
            returnValue: 'Filter',
          } as HookTypeMeta,
        },
      ];

      const rawTypeProperties = {
        FilterOptions: {
          locale: {
            typeText: 'string',
            required: true as const,
          },
          caseSensitive: {
            typeText: 'boolean',
          },
        },
      };

      const result = await highlightTypesMeta(types, { rawTypeProperties });

      const hook = result[0];
      expect(hook.type).toBe('hook');
      if (hook.type === 'hook') {
        // Should have expanded to optionsProperties
        expect(hook.data.optionsProperties).toBeDefined();
        expect(Object.keys(hook.data.optionsProperties!)).toEqual(['locale', 'caseSensitive']);
        // Should have optionsTypeName set
        expect(hook.data.optionsTypeName).toBe('FilterOptions');
        // Each property should be enhanced
        expect(hasEnhancedFields(hook.data.optionsProperties!.locale)).toBe(true);
        expect(extractText(hook.data.optionsProperties!.locale.type)).toBe('string');
        expect(hasEnhancedFields(hook.data.optionsProperties!.caseSensitive)).toBe(true);
        expect(extractText(hook.data.optionsProperties!.caseSensitive.type)).toBe('boolean');
        // Original parameters should still exist
        expect(Object.keys(hook.data.parameters!)).toEqual(['options']);
      }
    });

    it('should expand single optional parameter with "| undefined" suffix', async () => {
      const types: TypesMeta[] = [
        {
          type: 'hook',
          name: 'useFilter',
          data: {
            name: 'useFilter',
            parameters: {
              options: {
                typeText: 'FilterOptions | undefined',
                optional: true,
              },
            },
            returnValue: 'Filter',
          } as HookTypeMeta,
        },
      ];

      const rawTypeProperties = {
        FilterOptions: {
          locale: {
            typeText: 'string',
          },
        },
      };

      const result = await highlightTypesMeta(types, { rawTypeProperties });

      const hook = result[0];
      expect(hook.type).toBe('hook');
      if (hook.type === 'hook') {
        expect(hook.data.optionsProperties).toBeDefined();
        expect(Object.keys(hook.data.optionsProperties!)).toEqual(['locale']);
        expect(hook.data.optionsTypeName).toBe('FilterOptions');
        expect(hasEnhancedFields(hook.data.optionsProperties!.locale)).toBe(true);
      }
    });

    it('should not expand parameters when multiple parameters exist', async () => {
      const types: TypesMeta[] = [
        {
          type: 'hook',
          name: 'useSearch',
          data: {
            name: 'useSearch',
            parameters: {
              query: {
                typeText: 'string',
              },
              options: {
                typeText: 'SearchOptions',
                optional: true,
              },
            },
            returnValue: 'SearchResult',
          } as HookTypeMeta,
        },
      ];

      const rawTypeProperties = {
        SearchOptions: {
          limit: { typeText: 'number' },
        },
      };

      const result = await highlightTypesMeta(types, { rawTypeProperties });

      const hook = result[0];
      if (hook.type === 'hook') {
        // Should NOT expand - still has original parameters
        expect(Object.keys(hook.data.parameters!)).toEqual(['query', 'options']);
        expect(hook.data.optionsTypeName).toBeUndefined();
        expect(hook.data.optionsProperties).toBeUndefined();
      }
    });
  });

  describe('raw types', () => {
    it('should enhance raw types with highlighted formattedCode', async () => {
      const types: TypesMeta[] = [
        {
          type: 'raw',
          name: 'ButtonProps',
          data: {
            name: 'ButtonProps',
            formattedCode: 'type ButtonProps = { disabled?: boolean }',
          },
        },
      ];

      const result = await highlightTypesMeta(types);

      const rawType = result[0];
      expect(rawType.type).toBe('raw');
      expect(rawType.name).toBe('ButtonProps');
      // formattedCode should be converted to HAST
      expect((rawType as any).data.formattedCode).toHaveProperty('type', 'root');
    });
  });

  describe('multiple types', () => {
    it('should enhance all types in array', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      // Check first type (Button)
      const button = result[0];
      if (button.type === 'component') {
        expect(hasEnhancedFields(button.data.props.disabled)).toBe(true);
      }

      // Check second type (Input)
      const input = result[1];
      if (input.type === 'component') {
        expect(hasEnhancedFields(input.data.props.value)).toBe(true);
      }
    });
  });

  describe('formatting options', () => {
    it('should respect shortTypeUnionPrintWidth for multiline unions', async () => {
      const types: TypesMeta[] = [
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
      ];

      // Use very small width to force multiline
      const result = await highlightTypesMeta(types, {
        formatting: { shortTypeUnionPrintWidth: 5 },
      });

      const component = result[0];
      if (component.type === 'component') {
        // shortType should still be "Union"
        expect(component.data.props.variant.shortTypeText).toBe('Union');
      }
    });
  });

  describe('highlightedExports type expansion', () => {
    it('should expand type references when highlightedExports are provided', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              className: {
                typeText: 'string | ((state: Slider.Root.State) => string)',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          'Slider.Root.State': createExpandingMockExport(
            '{ dragging: boolean; orientation: "horizontal" | "vertical" }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.className;
        // detailedType should exist because className triggers it and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.detailedType!)).toBe(
          `| string
| ((state: {
    dragging: boolean;
    orientation: 'horizontal' | 'vertical';
  }) => string)`,
        );
      }
    });

    it('should not generate detailedType when no refs are expanded', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              onClick: {
                typeText: '() => void',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      // No highlightedExports provided, so nothing to expand
      const result = await highlightTypesMeta(types, {
        highlightedExports: {},
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.onClick;
        // Even though onClick triggers shouldShowDetailedType,
        // detailedType is only added if expansion differs from original
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('should expand external type (union of literals) in prop type', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              orientation: {
                typeText: 'Orientation',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.orientation;
        // detailedType should contain the expanded union
        expect(prop.detailedType).toBeDefined();
        expect(extractText(prop.detailedType!)).toBe("'horizontal' | 'vertical'");
      }
    });

    it('should expand external type nested in callback parameter', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              onOrientationChange: {
                typeText: '(orientation: Orientation) => void',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.onOrientationChange;
        expect(prop.detailedType).toBeDefined();
        expect(extractText(prop.detailedType!)).toBe(
          "(orientation: 'horizontal' | 'vertical') => void",
        );
      }
    });

    it('should expand external type in object property', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              config: {
                typeText: '{ orientation: Orientation; disabled: boolean }',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.config;
        expect(prop.detailedType).toBeDefined();
        expect(extractText(prop.detailedType!)).toBe(
          `{\n  orientation: 'horizontal' | 'vertical';\n  disabled: boolean;\n}`,
        );
      }
    });

    it('should expand multiple external types in same prop', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              config: {
                typeText: '{ orientation: Orientation; size: Size }',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
          Size: createExpandingMockExport("'small' | 'medium' | 'large'"),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.config;
        expect(prop.detailedType).toBeDefined();
        expect(extractText(prop.detailedType!)).toBe(
          `{\n  orientation: 'horizontal' | 'vertical';\n  size: 'small' | 'medium' | 'large';\n}`,
        );
      }
    });

    it('should expand external type in hook parameter', async () => {
      const types: TypesMeta[] = [
        {
          type: 'hook',
          name: 'useSlider',
          data: {
            name: 'useSlider',
            parameters: {
              orientation: {
                typeText: 'Orientation',
              },
            },
            returnValue: 'void',
          } as HookTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const hook = result[0];
      if (hook.type === 'hook') {
        const param = hook.data.parameters!.orientation;
        expect(param.detailedType).toBeDefined();
        expect(extractText(param.detailedType!)).toBe("'horizontal' | 'vertical'");
      }
    });

    it('should expand external type in function parameter', async () => {
      const types: TypesMeta[] = [
        {
          type: 'function',
          name: 'setOrientation',
          data: {
            name: 'setOrientation',
            parameters: {
              orientation: {
                typeText: 'Orientation',
              },
            },
            returnValue: 'void',
          },
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const func = result[0];
      if (func.type === 'function') {
        const param = func.data.parameters!.orientation;
        expect(param.detailedType).toBeDefined();
        expect(extractText(param.detailedType!)).toBe("'horizontal' | 'vertical'");
      }
    });

    it('should expand external type in union with other types', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              orientation: {
                typeText: 'Orientation | undefined',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          Orientation: createExpandingMockExport("'horizontal' | 'vertical'"),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.orientation;
        expect(prop.detailedType).toBeDefined();
        expect(extractText(prop.detailedType!)).toBe("'horizontal' | 'vertical' | undefined");
      }
    });
  });

  describe('function types', () => {
    it('should enhance function parameters with HAST', async () => {
      const types: TypesMeta[] = [
        {
          type: 'function',
          name: 'formatValue',
          data: {
            name: 'formatValue',
            parameters: {
              value: { typeText: 'number' },
              options: { typeText: '{ precision: number }' },
            },
            returnValue: 'string',
          } as FunctionTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);

      const func = result[0];
      expect(func.type).toBe('function');
      if (func.type === 'function') {
        expect(hasEnhancedFields(func.data.parameters!.value)).toBe(true);
        expect(extractText(func.data.parameters!.value.type)).toBe('number');
        expect(hasEnhancedFields(func.data.parameters!.options)).toBe(true);
        // returnValue is a simple string type, so it becomes a HastRoot
        expect(extractText(func.data.returnValue as HastRoot)).toBe('string');
      }
    });

    it('should convert function returnValue to HAST', async () => {
      const types: TypesMeta[] = [
        {
          type: 'function',
          name: 'getValue',
          data: {
            name: 'getValue',
            parameters: {},
            returnValue: 'Promise<string>',
          } as FunctionTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);

      const func = result[0];
      if (func.type === 'function') {
        // returnValue is a simple string type, so it becomes a HastRoot
        const returnValue = func.data.returnValue as HastRoot;
        expect(returnValue.type).toBe('root');
        expect(extractText(returnValue)).toBe('Promise<string>');
      }
    });
    it('should expand single optional parameter with "| undefined" suffix', async () => {
      const types: TypesMeta[] = [
        {
          type: 'function',
          name: 'useFilter',
          data: {
            name: 'useFilter',
            parameters: {
              options: {
                typeText: 'FilterOptions | undefined',
                optional: true,
              },
            },
            returnValue: 'Filter',
          } as FunctionTypeMeta,
        },
      ];

      const rawTypeProperties = {
        FilterOptions: {
          locale: {
            typeText: 'string',
          },
        },
      };

      const result = await highlightTypesMeta(types, { rawTypeProperties });

      const func = result[0];
      expect(func.type).toBe('function');
      if (func.type === 'function') {
        expect(func.data.optionsProperties).toBeDefined();
        expect(Object.keys(func.data.optionsProperties!)).toEqual(['locale']);
        expect(func.data.optionsTypeName).toBe('FilterOptions');
        expect(hasEnhancedFields(func.data.optionsProperties!.locale)).toBe(true);
        // Original parameters should still exist
        expect(Object.keys(func.data.parameters!)).toEqual(['options']);
      }
    });
  });

  describe('HAST structure and defaults', () => {
    it('should preserve default string value text', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        expect(extractText(component.data.props.variant.default!)).toBe('"primary"');
      }
    });

    it('should wrap type HAST in code element', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const { type } = component.data.props.disabled;
        const codeElement = type.children[0];
        expect(codeElement).toHaveProperty('tagName', 'code');
      }
    });
  });

  describe('complete type transformation', () => {
    it('className: shortType="string | function", type=full text, detailedType=expanded', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              className: {
                typeText: 'string | ((state: SliderState) => string)',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          SliderState: createExpandingMockExport(
            '{ value: number; dragging: boolean; orientation: "horizontal" | "vertical" }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.className;

        // shortType: special-cased to "string | function" for className
        expect(prop.shortTypeText).toBe('string | function');
        expect(extractText(prop.shortType!)).toBe('string | function');

        // type: full original text as HAST
        expect(extractText(prop.type)).toBe('string | ((state: SliderState) => string)');

        // detailedType: exists because className always shows detailed and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.detailedType!)).toBe(
          `| string
| ((state: {
    value: number;
    dragging: boolean;
    orientation: 'horizontal' | 'vertical';
  }) => string)`,
        );
      }
    });

    it('onClick: shortType="function", type=full text, detailedType=expanded', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              onClick: {
                typeText: '(event: ClickEvent) => void',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          ClickEvent: createExpandingMockExport(
            '{ clientX: number; clientY: number; pageX: number; pageY: number }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.onClick;

        // shortType: "function" for on* props
        expect(prop.shortTypeText).toBe('function');
        expect(extractText(prop.shortType!)).toBe('function');

        // type: full original text
        expect(extractText(prop.type)).toBe('(event: ClickEvent) => void');

        // detailedType: exists because onClick always shows detailed and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.detailedType!)).toBe(
          `(event: {
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
}) => void`,
        );
      }
    });

    it('render: shortType="ReactElement | function", type=full text, detailedType=expanded', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Tooltip',
          data: {
            name: 'Tooltip',
            props: {
              render: {
                typeText: 'ReactElement | ((props: RenderProps) => ReactElement)',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          RenderProps: createExpandingMockExport(
            '{ children: ReactNode; className: string; style: React.CSSProperties }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const { render } = component.data.props;

        // shortType: special-cased to "ReactElement | function" for render
        expect(render.shortTypeText).toBe('ReactElement | function');
        expect(extractText(render.shortType!)).toBe('ReactElement | function');

        // type: full original text
        expect(extractText(render.type)).toBe(
          'ReactElement | ((props: RenderProps) => ReactElement)',
        );

        // detailedType: exists because render always shows detailed and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(render.detailedType!)).toBe(
          `| ReactElement
| ((props: {
    children: ReactNode;
    className: string;
    style: React.CSSProperties;
  }) => ReactElement)`,
        );
      }
    });

    it('style: shortType="React.CSSProperties | function", type=full text, detailedType=expanded', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              style: {
                typeText: 'React.CSSProperties | ((state: ButtonState) => React.CSSProperties)',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          ButtonState: createExpandingMockExport(
            '{ active: boolean; disabled: boolean; focused: boolean }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.style;

        // shortType: special-cased to "React.CSSProperties | function" for style
        expect(prop.shortTypeText).toBe('React.CSSProperties | function');
        expect(extractText(prop.shortType!)).toBe('React.CSSProperties | function');

        // type: full original text
        expect(extractText(prop.type)).toBe(
          'React.CSSProperties | ((state: ButtonState) => React.CSSProperties)',
        );

        // detailedType: exists because style always shows detailed and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.detailedType!)).toBe(
          `| React.CSSProperties
| ((state: {
    active: boolean;
    disabled: boolean;
    focused: boolean;
  }) => React.CSSProperties)`,
        );
      }
    });

    it('variant union: shortType="Union", type=full text, detailedType=undefined (no refs)', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              variant: {
                typeText: '"primary" | "secondary" | "tertiary" | "danger" | "warning"',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {},
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;

        // shortType: "Union" for union types
        expect(prop.shortTypeText).toBe('Union');
        expect(extractText(prop.shortType!)).toBe('Union');

        // type: full original text, formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.type)).toBe(
          `| 'primary'
| 'secondary'
| 'tertiary'
| 'danger'
| 'warning'`,
        );

        // detailedType: undefined because no refs to expand
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('simple boolean: shortType=undefined, type=full text, detailedType=undefined', async () => {
      const types: TypesMeta[] = [
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
      ];

      const result = await highlightTypesMeta(types);

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.disabled;

        // shortType: undefined for simple types (no shortening needed)
        expect(prop.shortType).toBeUndefined();
        expect(prop.shortTypeText).toBeUndefined();

        // type: full original text
        expect(extractText(prop.type)).toBe('boolean');

        // detailedType: undefined for simple types
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('children: shortType=undefined, type=full text, detailedType=undefined (never expanded)', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              children: {
                typeText: 'React.ReactNode',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          'React.ReactNode': createMockHighlightedExport('React.ReactNode'),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.children;

        // shortType: undefined (not a function or union)
        expect(prop.shortType).toBeUndefined();
        expect(prop.shortTypeText).toBeUndefined();

        // type: full original text
        expect(extractText(prop.type)).toBe('React.ReactNode');

        // detailedType: undefined because children is never expanded
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('ref prop: shortType=undefined, type=full text, detailedType=undefined (never expanded)', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              buttonRef: {
                typeText: 'React.Ref<HTMLButtonElement>',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.buttonRef;

        // shortType: undefined
        expect(prop.shortType).toBeUndefined();
        expect(prop.shortTypeText).toBeUndefined();

        // type: full original text
        expect(extractText(prop.type)).toBe('React.Ref<HTMLButtonElement>');

        // detailedType: undefined because ref props are never expanded
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('getter prop: shortType="function", type=full text, detailedType=expanded when refs exist', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Input',
          data: {
            name: 'Input',
            props: {
              getValue: {
                typeText: '(state: InputState) => string',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          InputState: createExpandingMockExport(
            '{ focused: boolean; value: string; disabled: boolean }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.getValue;

        // shortType: "function" for get* props
        expect(prop.shortTypeText).toBe('function');
        expect(extractText(prop.shortType!)).toBe('function');

        // type: full original text
        expect(extractText(prop.type)).toBe('(state: InputState) => string');

        // detailedType: exists because getValue always shows detailed and refs were expanded
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.detailedType!)).toBe(
          `(state: {
  focused: boolean;
  value: string;
  disabled: boolean;
}) => string`,
        );
      }
    });
  });

  describe('detailedType text content', () => {
    it('should preserve type text for event handler with type reference', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              onClick: {
                typeText: '(event: CustomEvent) => void',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          CustomEvent: createExpandingMockExport(
            '{ detail: string; timestamp: number; target: HTMLElement }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.onClick;
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(detailedType!)).toBe(
          `(event: {
  detail: string;
  timestamp: number;
  target: HTMLElement;
}) => void`,
        );
      }
    });

    it('should preserve type text for className with state callback', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Slider',
          data: {
            name: 'Slider',
            props: {
              className: {
                typeText: 'string | ((state: SliderState) => string)',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          SliderState: createExpandingMockExport(
            '{ dragging: boolean; orientation: "horizontal" | "vertical" }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.className;
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(detailedType!)).toBe(
          `| string
| ((state: {
    dragging: boolean;
    orientation: 'horizontal' | 'vertical';
  }) => string)`,
        );
      }
    });

    it('should wrap detailedType in pre > code structure', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Button',
          data: {
            name: 'Button',
            props: {
              onClick: {
                typeText: '(event: ClickEvent) => void',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types, {
        highlightedExports: {
          ClickEvent: createExpandingMockExport(
            '{ pageX: number; pageY: number; clientX: number; clientY: number }',
          ),
        },
      });

      const component = result[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.onClick;
        // Output is formatted by prettier (>60 chars triggers multiline)
        expect(extractText(detailedType!)).toBe(
          `(event: {
  pageX: number;
  pageY: number;
  clientX: number;
  clientY: number;
}) => void`,
        );
        // Verify pre > code structure
        const preElement = detailedType!.children[0];
        expect(preElement).toHaveProperty('tagName', 'pre');
        const codeElement = (preElement as any).children[0];
        expect(codeElement).toHaveProperty('tagName', 'code');
      }
    });
  });

  describe('shortType stripping for optional props', () => {
    it('should create shortType without | undefined for optional prop with string | undefined', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Test',
          data: {
            name: 'Test',
            props: {
              myProp: {
                typeText: 'string | undefined',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.myProp;
        // type should contain full original type (with | undefined)
        expect(extractText(prop.type)).toBe('string | undefined');
        // shortType should be "string" (stripped | undefined) so UI shows clean version
        expect(prop.shortTypeText).toBe('string');
        expect(extractText(prop.shortType!)).toBe('string');
      }
    });

    it('should create shortType without | undefined for optional prop with union | undefined', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Test',
          data: {
            name: 'Test',
            props: {
              myProp: {
                typeText: '"a" | "b" | undefined',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.myProp;
        // type should contain full original type
        expect(extractText(prop.type)).toBe('"a" | "b" | undefined');
        // shortType should be '"a" | "b"' (stripped | undefined)
        expect(prop.shortTypeText).toBe('"a" | "b"');
        expect(extractText(prop.shortType!)).toBe('"a" | "b"');
      }
    });

    it('should not strip | undefined for required prop with union | undefined', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Test',
          data: {
            name: 'Test',
            props: {
              myProp: {
                typeText: '"a" | "b" | undefined',
                required: true,
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.myProp;
        // type should contain full original type, formatted by prettier (singleQuote: true)
        // Short union stays on one line
        expect(extractText(prop.type)).toBe(`'a' | 'b' | undefined`);
        // shortType should be "Union" for 3-member union (not stripped because required)
        expect(prop.shortTypeText).toBe('Union');
      }
    });

    it('should use Union shortType for optional prop with complex union | undefined', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Test',
          data: {
            name: 'Test',
            props: {
              myProp: {
                typeText: '"primary" | "secondary" | "tertiary" | "danger" | "warning" | undefined',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.myProp;
        // type should contain full original type, formatted by prettier (>60 chars triggers multiline)
        expect(extractText(prop.type)).toBe(
          `| 'primary'
| 'secondary'
| 'tertiary'
| 'danger'
| 'warning'
| undefined`,
        );
        // shortType should be "Union" for 5-member union (after stripping | undefined)
        expect(prop.shortTypeText).toBe('Union');
      }
    });

    it('should not create shortType for prop without | undefined', async () => {
      const types: TypesMeta[] = [
        {
          type: 'component',
          name: 'Test',
          data: {
            name: 'Test',
            props: {
              myProp: {
                typeText: 'string',
              },
            },
            dataAttributes: {},
            cssVariables: {},
          } as ComponentTypeMeta,
        },
      ];

      const result = await highlightTypesMeta(types);
      const component = result[0];
      if (component.type === 'component') {
        const prop = component.data.props.myProp;
        // type should contain original type
        expect(extractText(prop.type)).toBe('string');
        // shortType should be undefined (no stripping needed, simple type)
        expect(prop.shortTypeText).toBeUndefined();
        expect(prop.shortType).toBeUndefined();
      }
    });
  });
});

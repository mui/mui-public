import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import type { ExportNode } from 'typescript-api-extractor';
import { highlightTypesMeta } from './highlightTypesMeta';
import type { TypesMeta } from '../syncTypes/syncTypes';
import type { ComponentTypeMeta } from '../syncTypes/formatComponent';
import type { HookTypeMeta } from '../syncTypes/formatHook';
import type { FunctionTypeMeta } from '../syncTypes/formatFunction';
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

      const result = await highlightTypesMeta(variantData);

      const component = result.Default.types[0];
      expect(component.type).toBe('component');
      if (component.type === 'component') {
        expect(hasEnhancedFields(component.data.props.disabled)).toBe(true);
        expect(extractText(component.data.props.disabled.type)).toBe('boolean');
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

      const result = await highlightTypesMeta(variantData);

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;
        expect(extractText(prop.default!)).toBe('"primary"');
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

      const result = await highlightTypesMeta(variantData);

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

      const result = await highlightTypesMeta(variantData);

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

      const result = await highlightTypesMeta(variantData);

      const hook = result.Default.types[0];
      if (hook.type === 'hook') {
        const returnValue = hook.data.returnValue as Record<string, any>;
        expect(hasEnhancedFields(returnValue.count)).toBe(true);
        expect(extractText(returnValue.count.type)).toBe('number');
        expect(hasEnhancedFields(returnValue.increment)).toBe(true);
        expect(extractText(returnValue.increment.type)).toBe('() => void');
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

      const result = await highlightTypesMeta(variantData);

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

      const result = await highlightTypesMeta(variantData);

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
      const result = await highlightTypesMeta(variantData, {
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

      const result = await highlightTypesMeta(variantData);

      expect(result.Default.typeNameMap).toEqual({ ButtonState: 'Button.State' });
    });
  });

  describe('highlightedExports type expansion', () => {
    it('should expand type references when highlightedExports are provided', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          'Slider.Root.State': createExpandingMockExport('{ dragging: boolean }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.className;
        // detailedType should exist because className triggers it and refs were expanded
        expect(extractText(prop.detailedType!)).toBe(
          'string | ((state: { dragging: boolean }) => string)',
        );
      }
    });

    it('should not generate detailedType when no refs are expanded', async () => {
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
                    typeText: '() => void',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      // No highlightedExports provided, so nothing to expand
      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {},
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.onClick;
        // Even though onClick triggers shouldShowDetailedType,
        // detailedType is only added if expansion differs from original
        expect(prop.detailedType).toBeUndefined();
      }
    });
  });

  describe('function types', () => {
    it('should enhance function parameters with HAST', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData);

      const func = result.Default.types[0];
      expect(func.type).toBe('function');
      if (func.type === 'function') {
        expect(hasEnhancedFields(func.data.parameters.value)).toBe(true);
        expect(extractText(func.data.parameters.value.type)).toBe('number');
        expect(hasEnhancedFields(func.data.parameters.options)).toBe(true);
        expect(extractText(func.data.returnValue)).toBe('string');
      }
    });

    it('should convert function returnValue to HAST', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
            {
              type: 'function',
              name: 'getValue',
              data: {
                name: 'getValue',
                parameters: {},
                returnValue: 'Promise<string>',
              } as FunctionTypeMeta,
            },
          ],
        },
      };

      const result = await highlightTypesMeta(variantData);

      const func = result.Default.types[0];
      if (func.type === 'function') {
        expect(func.data.returnValue.type).toBe('root');
        expect(extractText(func.data.returnValue)).toBe('Promise<string>');
      }
    });
  });

  describe('HAST structure and defaults', () => {
    it('should preserve default string value text', async () => {
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

      const result = await highlightTypesMeta(variantData);
      const component = result.Default.types[0];
      if (component.type === 'component') {
        expect(extractText(component.data.props.variant.default!)).toBe('"primary"');
      }
    });

    it('should wrap type HAST in code element', async () => {
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
      };

      const result = await highlightTypesMeta(variantData);
      const component = result.Default.types[0];
      if (component.type === 'component') {
        const { type } = component.data.props.disabled;
        const codeElement = type.children[0];
        expect(codeElement).toHaveProperty('tagName', 'code');
      }
    });
  });

  describe('complete type transformation', () => {
    it('className: shortType="string | function", type=full text, detailedType=expanded', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          SliderState: createExpandingMockExport('{ value: number }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.className;

        // shortType: special-cased to "string | function" for className
        expect(prop.shortTypeText).toBe('string | function');
        expect(extractText(prop.shortType!)).toBe('string | function');

        // type: full original text as HAST
        expect(extractText(prop.type)).toBe('string | ((state: SliderState) => string)');

        // detailedType: exists because className always shows detailed and refs were expanded
        expect(extractText(prop.detailedType!)).toBe(
          'string | ((state: { value: number }) => string)',
        );
      }
    });

    it('onClick: shortType="function", type=full text, detailedType=expanded', async () => {
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
                    typeText: '(event: ClickEvent) => void',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          ClickEvent: createExpandingMockExport('{ x: number; y: number }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.onClick;

        // shortType: "function" for on* props
        expect(prop.shortTypeText).toBe('function');
        expect(extractText(prop.shortType!)).toBe('function');

        // type: full original text
        expect(extractText(prop.type)).toBe('(event: ClickEvent) => void');

        // detailedType: exists because onClick always shows detailed and refs were expanded
        expect(extractText(prop.detailedType!)).toBe('(event: { x: number; y: number }) => void');
      }
    });

    it('render: shortType="ReactElement | function", type=full text, detailedType=expanded', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          RenderProps: createExpandingMockExport('{ children: ReactNode }'),
        },
      });

      const component = result.Default.types[0];
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
        expect(extractText(render.detailedType!)).toBe(
          'ReactElement | ((props: { children: ReactNode }) => ReactElement)',
        );
      }
    });

    it('style: shortType="React.CSSProperties | function", type=full text, detailedType=expanded', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          ButtonState: createExpandingMockExport('{ active: boolean }'),
        },
      });

      const component = result.Default.types[0];
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
        expect(extractText(prop.detailedType!)).toBe(
          'React.CSSProperties | ((state: { active: boolean }) => React.CSSProperties)',
        );
      }
    });

    it('variant union: shortType="Union", type=full text, detailedType=undefined (no refs)', async () => {
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

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {},
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.variant;

        // shortType: "Union" for union types
        expect(prop.shortTypeText).toBe('Union');
        expect(extractText(prop.shortType!)).toBe('Union');

        // type: full original text
        expect(extractText(prop.type)).toBe('"primary" | "secondary" | "tertiary"');

        // detailedType: undefined because no refs to expand
        expect(prop.detailedType).toBeUndefined();
      }
    });

    it('simple boolean: shortType=undefined, type=full text, detailedType=undefined', async () => {
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

      const result = await highlightTypesMeta(variantData);

      const component = result.Default.types[0];
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
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          'React.ReactNode': createMockHighlightedExport('React.ReactNode'),
        },
      });

      const component = result.Default.types[0];
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
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData);

      const component = result.Default.types[0];
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
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          InputState: createExpandingMockExport('{ focused: boolean }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const prop = component.data.props.getValue;

        // shortType: "function" for get* props
        expect(prop.shortTypeText).toBe('function');
        expect(extractText(prop.shortType!)).toBe('function');

        // type: full original text
        expect(extractText(prop.type)).toBe('(state: InputState) => string');

        // detailedType: exists because getValue always shows detailed and refs were expanded
        expect(extractText(prop.detailedType!)).toBe('(state: { focused: boolean }) => string');
      }
    });
  });

  describe('detailedType text content', () => {
    it('should preserve type text for event handler with type reference', async () => {
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
                    typeText: '(event: CustomEvent) => void',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          CustomEvent: createExpandingMockExport('{ detail: string }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.onClick;
        expect(extractText(detailedType!)).toBe('(event: { detail: string }) => void');
      }
    });

    it('should preserve type text for className with state callback', async () => {
      const variantData: Record<string, { types: TypesMeta[] }> = {
        Default: {
          types: [
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
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          SliderState: createExpandingMockExport('{ dragging: boolean }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.className;
        expect(extractText(detailedType!)).toBe(
          'string | ((state: { dragging: boolean }) => string)',
        );
      }
    });

    it('should wrap detailedType in pre > code structure', async () => {
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
                    typeText: '(event: ClickEvent) => void',
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              } as ComponentTypeMeta,
            },
          ],
        },
      };

      const result = await highlightTypesMeta(variantData, {
        highlightedExports: {
          ClickEvent: createExpandingMockExport('{ pageX: number }'),
        },
      });

      const component = result.Default.types[0];
      if (component.type === 'component') {
        const { detailedType } = component.data.props.onClick;
        expect(extractText(detailedType!)).toBe('(event: { pageX: number }) => void');
        // Verify pre > code structure
        const preElement = detailedType!.children[0];
        expect(preElement).toHaveProperty('tagName', 'pre');
        const codeElement = (preElement as any).children[0];
        expect(codeElement).toHaveProperty('tagName', 'code');
      }
    });
  });
});

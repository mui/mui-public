import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import type { EnhancedTypesMeta } from '../pipeline/loadServerTypes';
import { typeToJsx, additionalTypesToJsx } from './typesToJsx';

/**
 * Helper to create a simple HAST root node with text content.
 */
function createHastRoot(text: string): HastRoot {
  return {
    type: 'root',
    children: [{ type: 'text', value: text }],
  };
}

/**
 * Helper to create an EnhancedComponentTypeMeta for testing.
 * Uses 'unknown' cast to satisfy TypeScript while providing minimal mock data.
 */
function createEnhancedComponent(
  name: string,
  options: {
    propsType?: HastRoot;
    props?: Record<
      string,
      {
        type: HastRoot;
        typeText: string;
        required?: boolean;
        description?: HastRoot;
        default?: HastRoot;
      }
    >;
    description?: HastRoot;
    dataAttributes?: Record<string, any>;
    cssVariables?: Record<string, any>;
  } = {},
): EnhancedTypesMeta {
  return {
    type: 'component',
    name,
    data: {
      name,
      propsType: options.propsType ?? createHastRoot('ButtonProps'),
      props: options.props ?? {
        disabled: {
          type: createHastRoot('boolean'),
          typeText: 'boolean',
          required: false,
        },
      },
      description: options.description,
      dataAttributes: options.dataAttributes ?? {},
      cssVariables: options.cssVariables ?? {},
    },
  } as unknown as EnhancedTypesMeta;
}

/**
 * Helper to create an EnhancedHookTypeMeta for testing.
 */
function createEnhancedHook(
  name: string,
  options: {
    parameters?: Record<
      string,
      {
        type: HastRoot;
        typeText: string;
        required?: boolean;
        description?: HastRoot;
      }
    >;
    returnValue?:
      | HastRoot
      | Record<
          string,
          {
            type: HastRoot;
            typeText: string;
            required?: boolean;
            description?: HastRoot;
          }
        >;
    description?: HastRoot;
  } = {},
): EnhancedTypesMeta {
  return {
    type: 'hook',
    name,
    data: {
      name,
      parameters: options.parameters ?? {},
      returnValue: options.returnValue ?? createHastRoot('void'),
      description: options.description,
    },
  } as unknown as EnhancedTypesMeta;
}

/**
 * Helper to create an EnhancedRawTypeMeta for testing.
 */
function createEnhancedRaw(
  name: string,
  options: {
    formattedCode?: HastRoot;
    description?: HastRoot;
    enumMembers?: Array<{
      name: string;
      value?: string | number;
      description?: HastRoot;
    }>;
  } = {},
): EnhancedTypesMeta {
  return {
    type: 'raw',
    name,
    data: {
      name,
      formattedCode: options.formattedCode ?? createHastRoot('type MyType = {}'),
      description: options.description,
      enumMembers: options.enumMembers,
    },
  } as unknown as EnhancedTypesMeta;
}

describe('typesToJsx', () => {
  describe('typeToJsx', () => {
    describe('component types', () => {
      it('should process a component type', () => {
        const component = createEnhancedComponent('Button');
        const result = typeToJsx({ type: component, additionalTypes: [] }, undefined);

        expect(result.type).toBeDefined();
        expect(result.type?.type).toBe('component');
        expect(result.type?.name).toBe('Button');
      });

      it('should process component props', () => {
        const component = createEnhancedComponent('Button', {
          props: {
            disabled: {
              type: createHastRoot('boolean'),
              typeText: 'boolean',
              required: false,
              description: createHastRoot('Whether the button is disabled'),
            },
            onClick: {
              type: createHastRoot('() => void'),
              typeText: '() => void',
              required: true,
            },
          },
        });
        const result = typeToJsx({ type: component, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('component');
        if (result.type?.type === 'component') {
          expect(result.type.data.props).toBeDefined();
          expect('disabled' in result.type.data.props).toBe(true);
          expect('onClick' in result.type.data.props).toBe(true);
        }
      });

      it('should process component description', () => {
        const component = createEnhancedComponent('Button', {
          description: createHastRoot('A clickable button component'),
        });
        const result = typeToJsx({ type: component, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('component');
        if (result.type?.type === 'component') {
          expect(result.type.data.description).toBeDefined();
        }
      });
    });

    describe('hook types', () => {
      it('should process a hook type', () => {
        const hook = createEnhancedHook('useButton');
        const result = typeToJsx({ type: hook, additionalTypes: [] }, undefined);

        expect(result.type).toBeDefined();
        expect(result.type?.type).toBe('hook');
        expect(result.type?.name).toBe('useButton');
      });

      it('should process hook parameters', () => {
        const hook = createEnhancedHook('useButton', {
          parameters: {
            options: {
              type: createHastRoot('ButtonOptions'),
              typeText: 'ButtonOptions',
              required: true,
              description: createHastRoot('Configuration options'),
            },
          },
        });
        const result = typeToJsx({ type: hook, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('hook');
        if (result.type?.type === 'hook') {
          expect(result.type.data.parameters).toBeDefined();
          expect('options' in result.type.data.parameters).toBe(true);
        }
      });

      it('should process hook with object return value', () => {
        const hook = createEnhancedHook('useButton', {
          returnValue: {
            getRootProps: {
              type: createHastRoot('() => ButtonRootProps'),
              typeText: '() => ButtonRootProps',
              required: true,
            },
            disabled: {
              type: createHastRoot('boolean'),
              typeText: 'boolean',
              required: true,
            },
          },
        });
        const result = typeToJsx({ type: hook, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('hook');
        if (result.type?.type === 'hook') {
          expect(result.type.data.returnValue).toBeDefined();
        }
      });
    });

    describe('raw types', () => {
      it('should process a raw type', () => {
        const raw = createEnhancedRaw('ButtonState');
        const result = typeToJsx({ type: raw, additionalTypes: [] }, undefined);

        expect(result.type).toBeDefined();
        expect(result.type?.type).toBe('raw');
        expect(result.type?.name).toBe('ButtonState');
      });

      it('should process raw type with description', () => {
        const raw = createEnhancedRaw('ButtonState', {
          description: createHastRoot('State of the button'),
        });
        const result = typeToJsx({ type: raw, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('raw');
        if (result.type?.type === 'raw') {
          expect(result.type.data.description).toBeDefined();
        }
      });

      it('should process raw type with enum members', () => {
        const raw = createEnhancedRaw('Direction', {
          enumMembers: [
            { name: 'Up', value: 'up', description: createHastRoot('Move up') },
            { name: 'Down', value: 'down' },
          ],
        });
        const result = typeToJsx({ type: raw, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('raw');
        if (result.type?.type === 'raw') {
          expect(result.type.data.enumMembers).toBeDefined();
          expect(result.type.data.enumMembers).toHaveLength(2);
          expect(result.type.data.enumMembers?.[0].name).toBe('Up');
        }
      });

      it('should process raw type with reExportOf', () => {
        const raw: EnhancedTypesMeta = {
          type: 'raw',
          name: 'Accordion.Trigger.Props',
          data: {
            name: 'Accordion.Trigger.Props',
            formattedCode: createHastRoot('type Props = {}'),
            reExportOf: {
              name: 'Trigger',
              slug: '#trigger',
              suffix: 'props',
            },
          },
        } as unknown as EnhancedTypesMeta;

        const result = typeToJsx({ type: raw, additionalTypes: [] }, undefined);

        expect(result.type?.type).toBe('raw');
        if (result.type?.type === 'raw') {
          expect(result.type.data.reExportOf).toEqual({
            name: 'Trigger',
            slug: '#trigger',
            suffix: 'props',
          });
        }
      });
    });

    describe('additional types', () => {
      it('should process additional types in exportData', () => {
        const component = createEnhancedComponent('Button');
        const additionalType = createEnhancedRaw('Button.State');
        const result = typeToJsx({ type: component, additionalTypes: [additionalType] }, undefined);

        expect(result.additionalTypes).toHaveLength(1);
        expect(result.additionalTypes[0].type).toBe('raw');
        expect(result.additionalTypes[0].name).toBe('Button.State');
      });

      it('should include global additional types when includeGlobalAdditionalTypes is true', () => {
        const component = createEnhancedComponent('Button');
        const globalType = createEnhancedRaw('SharedType');
        const result = typeToJsx(
          { type: component, additionalTypes: [] },
          [globalType],
          undefined,
          true, // includeGlobalAdditionalTypes
        );

        expect(result.additionalTypes).toHaveLength(1);
        expect(result.additionalTypes[0].name).toBe('SharedType');
      });

      it('should NOT include global additional types when includeGlobalAdditionalTypes is false', () => {
        const component = createEnhancedComponent('Button');
        const globalType = createEnhancedRaw('SharedType');
        const result = typeToJsx(
          { type: component, additionalTypes: [] },
          [globalType],
          undefined,
          false, // includeGlobalAdditionalTypes
        );

        expect(result.additionalTypes).toHaveLength(0);
      });

      it('should combine export additional types and global additional types', () => {
        const component = createEnhancedComponent('Button');
        const exportAdditional = createEnhancedRaw('Button.State');
        const globalType = createEnhancedRaw('SharedType');
        const result = typeToJsx(
          { type: component, additionalTypes: [exportAdditional] },
          [globalType],
          undefined,
          true,
        );

        expect(result.additionalTypes).toHaveLength(2);
      });
    });

    describe('undefined export data', () => {
      it('should handle undefined exportData', () => {
        const result = typeToJsx(undefined, undefined);

        expect(result.type).toBeUndefined();
        expect(result.additionalTypes).toEqual([]);
      });

      it('should process global additional types when exportData is undefined', () => {
        const globalType = createEnhancedRaw('LoaderOptions');
        const result = typeToJsx(undefined, [globalType], undefined, true);

        expect(result.type).toBeUndefined();
        expect(result.additionalTypes).toHaveLength(1);
        expect(result.additionalTypes[0].name).toBe('LoaderOptions');
      });

      it('should return empty additionalTypes when exportData is undefined and includeGlobalAdditionalTypes is false', () => {
        const globalType = createEnhancedRaw('LoaderOptions');
        const result = typeToJsx(undefined, [globalType], undefined, false);

        expect(result.type).toBeUndefined();
        expect(result.additionalTypes).toEqual([]);
      });
    });
  });

  describe('additionalTypesToJsx', () => {
    it('should return empty array for undefined input', () => {
      const result = additionalTypesToJsx(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty array input', () => {
      const result = additionalTypesToJsx([]);
      expect(result).toEqual([]);
    });

    it('should process additional types', () => {
      const types = [createEnhancedRaw('Type1'), createEnhancedRaw('Type2')];
      const result = additionalTypesToJsx(types);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Type1');
      expect(result[1].name).toBe('Type2');
    });

    it('should process mixed type kinds', () => {
      const types: EnhancedTypesMeta[] = [
        createEnhancedComponent('Button'),
        createEnhancedHook('useButton'),
        createEnhancedRaw('ButtonState'),
      ];
      const result = additionalTypesToJsx(types);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('component');
      expect(result[1].type).toBe('hook');
      expect(result[2].type).toBe('raw');
    });
  });
});

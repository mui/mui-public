import { describe, it, expect } from 'vitest';
import { organizeTypesByExport, type BaseTypeMeta } from './organizeTypesByExport';

/**
 * Helper to create a component type meta
 */
function createComponentMeta(name: string): BaseTypeMeta {
  return {
    name,
    type: 'component',
    data: { name, props: {}, dataAttributes: {}, cssVariables: {} },
  };
}

/**
 * Helper to create a hook type meta
 */
function createHookMeta(name: string): BaseTypeMeta {
  return {
    name,
    type: 'hook',
    data: { name, parameters: {}, returnValue: 'void' },
  };
}

/**
 * Helper to create a function type meta
 */
function createFunctionMeta(name: string): BaseTypeMeta {
  return {
    name,
    type: 'function',
    data: { name, parameters: {}, returnValue: 'void' },
  };
}

/**
 * Helper to create a raw type meta (for Props, State, etc.)
 */
function createRawMeta(name: string): BaseTypeMeta {
  return {
    name,
    type: 'raw',
    data: { name, formattedCode: `type ${name} = {}` },
  };
}

describe('organizeTypesByExport', () => {
  describe('empty input', () => {
    it('should return empty exports and additionalTypes for empty variantData', () => {
      const result = organizeTypesByExport({});

      expect(result.exports).toEqual({});
      expect(result.additionalTypes).toEqual([]);
      expect(result.variantTypeNames).toEqual({});
    });

    it('should return empty exports and additionalTypes when variant has no types', () => {
      const result = organizeTypesByExport({
        Default: { types: [] },
      });

      expect(result.exports).toEqual({});
      expect(result.additionalTypes).toEqual([]);
      expect(result.variantTypeNames).toEqual({ Default: [] });
    });
  });

  describe('single component without namespace', () => {
    it('should create export for simple component', () => {
      const buttonComponent = createComponentMeta('Button');
      const result = organizeTypesByExport({
        Default: { types: [buttonComponent] },
      });

      expect(Object.keys(result.exports)).toEqual(['Button']);
      expect(result.exports.Button.type.name).toBe('Button');
      expect(result.exports.Button.additionalTypes).toEqual([]);
      expect(result.additionalTypes).toEqual([]);
    });

    it('should place non-namespaced raw types in additionalTypes', () => {
      const buttonComponent = createComponentMeta('Button');
      const inputType = createRawMeta('InputType');

      const result = organizeTypesByExport({
        Default: { types: [buttonComponent, inputType] },
      });

      expect(Object.keys(result.exports)).toEqual(['Button']);
      expect(result.additionalTypes).toHaveLength(1);
      expect(result.additionalTypes[0].name).toBe('InputType');
    });
  });

  describe('namespaced components (e.g., Accordion.Root)', () => {
    it('should create exports for namespaced components', () => {
      const rootComponent = createComponentMeta('Accordion.Root');
      const triggerComponent = createComponentMeta('Accordion.Trigger');

      const result = organizeTypesByExport({
        Default: { types: [rootComponent, triggerComponent] },
      });

      expect(Object.keys(result.exports).sort()).toEqual(['Root', 'Trigger']);
      expect(result.exports.Root.type.name).toBe('Accordion.Root');
      expect(result.exports.Trigger.type.name).toBe('Accordion.Trigger');
    });

    it('should group Props and State with their parent component', () => {
      const rootComponent = createComponentMeta('Accordion.Root');
      const rootProps = createRawMeta('Accordion.Root.Props');
      const rootState = createRawMeta('Accordion.Root.State');

      const result = organizeTypesByExport({
        Default: { types: [rootComponent, rootProps, rootState] },
      });

      expect(Object.keys(result.exports)).toEqual(['Root']);
      expect(result.exports.Root.type.name).toBe('Accordion.Root');
      expect(result.exports.Root.additionalTypes).toHaveLength(2);
      expect(result.exports.Root.additionalTypes.map((t) => t.name)).toEqual([
        'Accordion.Root.Props',
        'Accordion.Root.State',
      ]);
    });
  });

  describe('sorting additionalTypes', () => {
    it('should sort additionalTypes by suffix order (Props, State, DataAttributes, CssVars)', () => {
      const rootComponent = createComponentMeta('Accordion.Root');
      const rootState = createRawMeta('Accordion.Root.State');
      const rootProps = createRawMeta('Accordion.Root.Props');
      const rootDataAttributes = createRawMeta('Accordion.Root.DataAttributes');
      const rootCssVars = createRawMeta('Accordion.Root.CssVars');

      // Add in random order
      const result = organizeTypesByExport({
        Default: {
          types: [rootComponent, rootCssVars, rootState, rootDataAttributes, rootProps],
        },
      });

      // Should be sorted: Props, State, DataAttributes, CssVars
      const additionalTypeNames = result.exports.Root.additionalTypes.map((t) => t.name);
      expect(additionalTypeNames).toEqual([
        'Accordion.Root.Props',
        'Accordion.Root.State',
        'Accordion.Root.DataAttributes',
        'Accordion.Root.CssVars',
      ]);
    });
  });

  describe('multiple variants', () => {
    it('should build variantTypeNames from all variants', () => {
      const buttonCss = createComponentMeta('Button');
      const buttonTailwind = createComponentMeta('Button');
      const iconButtonTailwind = createComponentMeta('IconButton');

      const result = organizeTypesByExport({
        CssModules: { types: [buttonCss] },
        Tailwind: { types: [buttonTailwind, iconButtonTailwind] },
      });

      expect(result.variantTypeNames).toEqual({
        CssModules: ['Button'],
        Tailwind: ['Button', 'IconButton'],
      });
    });

    it('should deduplicate types across variants', () => {
      const buttonCss = createComponentMeta('Button');
      const buttonTailwind = createComponentMeta('Button');

      const result = organizeTypesByExport({
        CssModules: { types: [buttonCss] },
        Tailwind: { types: [buttonTailwind] },
      });

      // Should only have one Button export despite two variants
      expect(Object.keys(result.exports)).toEqual(['Button']);
    });

    it('should prefer component types over raw types when deduplicating', () => {
      // If same name appears as raw in one variant and component in another
      const buttonRaw = createRawMeta('Button');
      const buttonComponent = createComponentMeta('Button');

      const result = organizeTypesByExport({
        First: { types: [buttonRaw] },
        Second: { types: [buttonComponent] },
      });

      // Should prefer the component type
      expect(result.exports.Button.type.type).toBe('component');
    });
  });

  describe('typeNameMap filtering', () => {
    it('should filter out flat types that have namespaced equivalents', () => {
      const rootComponent = createComponentMeta('Accordion.Root');
      const rootState = createRawMeta('Accordion.Root.State');
      const flatState = createRawMeta('AccordionRootState');

      const typeNameMap = {
        AccordionRootState: 'Accordion.Root.State',
      };

      const result = organizeTypesByExport(
        {
          Default: { types: [rootComponent, rootState, flatState] },
        },
        typeNameMap,
      );

      // flatState should be filtered out since it has a namespaced equivalent
      expect(result.additionalTypes).toEqual([]);
      // The namespaced version should still be in the export
      expect(result.exports.Root.additionalTypes.map((t) => t.name)).toContain(
        'Accordion.Root.State',
      );
    });

    it('should not filter non-namespaced types without equivalents', () => {
      const buttonComponent = createComponentMeta('Button');
      const inputType = createRawMeta('InputType');

      const result = organizeTypesByExport(
        {
          Default: { types: [buttonComponent, inputType] },
        },
        {}, // Empty typeNameMap
      );

      // InputType should remain since it has no namespaced equivalent
      expect(result.additionalTypes).toHaveLength(1);
      expect(result.additionalTypes[0].name).toBe('InputType');
    });
  });

  describe('hooks and functions', () => {
    it('should create exports for hooks', () => {
      const useButton = createHookMeta('useButton');

      const result = organizeTypesByExport({
        Default: { types: [useButton] },
      });

      expect(Object.keys(result.exports)).toEqual(['useButton']);
      expect(result.exports.useButton.type.type).toBe('hook');
    });

    it('should create exports for functions', () => {
      const formatValue = createFunctionMeta('formatValue');

      const result = organizeTypesByExport({
        Default: { types: [formatValue] },
      });

      expect(Object.keys(result.exports)).toEqual(['formatValue']);
      expect(result.exports.formatValue.type.type).toBe('function');
    });
  });

  describe('mixed types scenario', () => {
    it('should correctly organize complex component with all type kinds', () => {
      const types: BaseTypeMeta[] = [
        createComponentMeta('Accordion.Root'),
        createComponentMeta('Accordion.Trigger'),
        createComponentMeta('Accordion.Header'),
        createRawMeta('Accordion.Root.Props'),
        createRawMeta('Accordion.Root.State'),
        createRawMeta('Accordion.Trigger.Props'),
        createRawMeta('Accordion.Trigger.State'),
        createHookMeta('useAccordionRoot'),
        createRawMeta('AccordionValue'),
      ];

      const result = organizeTypesByExport({
        Default: { types },
      });

      // Should have exports for Root, Trigger, Header, and useAccordionRoot
      expect(Object.keys(result.exports).sort()).toEqual([
        'Header',
        'Root',
        'Trigger',
        'useAccordionRoot',
      ]);

      // Root should have Props and State as additionalTypes
      expect(result.exports.Root.additionalTypes.map((t) => t.name)).toEqual([
        'Accordion.Root.Props',
        'Accordion.Root.State',
      ]);

      // Trigger should have Props and State as additionalTypes
      expect(result.exports.Trigger.additionalTypes.map((t) => t.name)).toEqual([
        'Accordion.Trigger.Props',
        'Accordion.Trigger.State',
      ]);

      // AccordionValue (non-namespaced) should be in additionalTypes
      expect(result.additionalTypes.map((t) => t.name)).toEqual(['AccordionValue']);
    });
  });

  describe('edge cases', () => {
    it('should handle exports without main type (moves to additionalTypes)', () => {
      // This is a case where we have additional types but no main component
      const orphanProps = createRawMeta('Orphan.Props');

      const result = organizeTypesByExport({
        Default: { types: [orphanProps] },
      });

      // Since there's no Orphan component, the props should move to top-level additionalTypes
      expect(Object.keys(result.exports)).toEqual([]);
      expect(result.additionalTypes).toHaveLength(1);
      expect(result.additionalTypes[0].name).toBe('Orphan.Props');
    });

    it('should handle 2-part names where second part matches a main type name', () => {
      // This tests the case where "Accordion.Root" exists as a component
      // and we have a raw type "Accordion.Root" (shouldn't happen normally but test the logic)
      const rootComponent = createComponentMeta('Accordion.Root');
      const rootRaw = createRawMeta('Accordion.Root');

      const result = organizeTypesByExport({
        First: { types: [rootRaw] },
        Second: { types: [rootComponent] },
      });

      // Should prefer the component
      expect(result.exports.Root.type.type).toBe('component');
    });
  });
});

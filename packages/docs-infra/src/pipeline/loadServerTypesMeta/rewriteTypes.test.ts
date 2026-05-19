import { describe, it, expect } from 'vitest';
import { buildTypeCompatibilityMap, rewriteTypeStringsDeep } from './rewriteTypes';

describe('buildTypeCompatibilityMap', () => {
  describe('reexportedFrom mapping', () => {
    it('should map reexportedFrom to the new export name', () => {
      const exports = [
        {
          name: 'AlertDialog.Trigger',
          reexportedFrom: 'DialogTrigger',
          type: { kind: 'component', props: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogTrigger')).toBe('AlertDialog.Trigger');
    });

    it('should not map when reexportedFrom equals the export name', () => {
      const exports = [
        {
          name: 'DialogTrigger',
          reexportedFrom: 'DialogTrigger',
          type: { kind: 'component', props: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.has('DialogTrigger')).toBe(false);
    });

    it('should handle multiple exports with different reexportedFrom values', () => {
      const exports = [
        {
          name: 'AlertDialog.Trigger',
          reexportedFrom: 'DialogTrigger',
          type: { kind: 'component', props: [] },
        },
        {
          name: 'AlertDialog.Root',
          reexportedFrom: 'DialogRoot',
          type: { kind: 'component', props: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogTrigger')).toBe('AlertDialog.Trigger');
      expect(map.get('DialogRoot')).toBe('AlertDialog.Root');
    });
  });

  describe('extendsTypes mapping', () => {
    it('should map extendsTypes name to the export', () => {
      const exports = [
        {
          name: 'AlertDialog.Trigger.State',
          extendsTypes: [{ name: 'DialogTrigger.State' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogTrigger.State')).toBe('AlertDialog.Trigger.State');
    });

    it('should map extendsTypes resolvedName to the export', () => {
      const exports = [
        {
          name: 'AlertDialog.Trigger.State',
          extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogTrigger.State')).toBe('AlertDialog.Trigger.State');
      expect(map.get('DialogTriggerState')).toBe('AlertDialog.Trigger.State');
    });

    it('should handle multiple extendsTypes on one export', () => {
      const exports = [
        {
          name: 'AlertDialog.Root.Props',
          extendsTypes: [
            { name: 'DialogRoot.Props', resolvedName: 'DialogRootProps' },
            { name: 'BaseUI.Props', resolvedName: 'BaseUIProps' },
          ],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogRoot.Props')).toBe('AlertDialog.Root.Props');
      expect(map.get('DialogRootProps')).toBe('AlertDialog.Root.Props');
      expect(map.get('BaseUI.Props')).toBe('AlertDialog.Root.Props');
      expect(map.get('BaseUIProps')).toBe('AlertDialog.Root.Props');
    });

    it('should not duplicate map entry when name equals resolvedName', () => {
      const exports = [
        {
          name: 'AlertDialog.State',
          extendsTypes: [{ name: 'DialogState', resolvedName: 'DialogState' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('DialogState')).toBe('AlertDialog.State');
      expect(map.size).toBe(1);
    });

    it('should not map extendsTypes when the extended type is a public export', () => {
      // ToastManagerAddOptions extends Omit<ToastObject, ...>, but ToastObject is
      // itself a public export and should not be rewritten.
      const exports = [
        {
          name: 'ToastManagerAddOptions',
          extendsTypes: [{ name: 'ToastObject', resolvedName: 'ToastObject' }],
          type: { kind: 'interface', properties: [] },
        },
        {
          name: 'ToastObject',
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, ['ToastManagerAddOptions', 'ToastObject']);

      // ToastObject should NOT be mapped to ToastManagerAddOptions
      expect(map.has('ToastObject')).toBe(false);
      expect(map.size).toBe(0);
    });
  });

  describe('combined reexportedFrom and extendsTypes', () => {
    it('should build complete map from realistic AlertDialog scenario', () => {
      // Simulates a real AlertDialog that inherits from Dialog
      const exports = [
        {
          name: 'AlertDialog.Trigger',
          reexportedFrom: 'DialogTrigger',
          type: { kind: 'component', props: [] },
        },
        {
          name: 'AlertDialog.Trigger.State',
          extendsTypes: [{ name: 'DialogTrigger.State', resolvedName: 'DialogTriggerState' }],
          type: { kind: 'interface', properties: [] },
        },
        {
          name: 'AlertDialog.Trigger.Props',
          extendsTypes: [{ name: 'DialogTrigger.Props', resolvedName: 'DialogTriggerProps' }],
          type: { kind: 'interface', properties: [] },
        },
        {
          name: 'AlertDialog.Root',
          reexportedFrom: 'DialogRoot',
          type: { kind: 'component', props: [] },
        },
        {
          name: 'AlertDialog.Root.State',
          extendsTypes: [{ name: 'DialogRoot.State', resolvedName: 'DialogRootState' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      // reexportedFrom mappings
      expect(map.get('DialogTrigger')).toBe('AlertDialog.Trigger');
      expect(map.get('DialogRoot')).toBe('AlertDialog.Root');

      // extendsTypes mappings (dotted format)
      expect(map.get('DialogTrigger.State')).toBe('AlertDialog.Trigger.State');
      expect(map.get('DialogTrigger.Props')).toBe('AlertDialog.Trigger.Props');
      expect(map.get('DialogRoot.State')).toBe('AlertDialog.Root.State');

      // extendsTypes mappings (flat format)
      expect(map.get('DialogTriggerState')).toBe('AlertDialog.Trigger.State');
      expect(map.get('DialogTriggerProps')).toBe('AlertDialog.Trigger.Props');
      expect(map.get('DialogRootState')).toBe('AlertDialog.Root.State');
    });

    it('should not overwrite existing mappings when both are dotted (first wins)', () => {
      // If two dotted exports claim to extend the same type, the first one wins
      const exports = [
        {
          name: 'AlertDialog.Trigger.State',
          extendsTypes: [{ name: 'SharedState' }],
          type: { kind: 'interface', properties: [] },
        },
        {
          name: 'AlertDialog.Root.State',
          extendsTypes: [{ name: 'SharedState' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      // First export wins
      expect(map.get('SharedState')).toBe('AlertDialog.Trigger.State');
    });

    it('should prefer dotted names over flat names as canonical mappings', () => {
      // When both flat and dotted exports extend the same type,
      // prefer the dotted version regardless of order
      const exports = [
        {
          // Flat export comes first
          name: 'ToolbarSeparatorState',
          extendsTypes: [{ name: 'Separator.State', resolvedName: 'SeparatorState' }],
          type: { kind: 'interface', properties: [] },
        },
        {
          // Dotted export comes second
          name: 'Toolbar.Separator.State',
          extendsTypes: [{ name: 'Separator.State', resolvedName: 'SeparatorState' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      // Should prefer the dotted name even though flat came first
      expect(map.get('Separator.State')).toBe('Toolbar.Separator.State');
      expect(map.get('SeparatorState')).toBe('Toolbar.Separator.State');
    });

    it('should prefer dotted names over flat names for reexportedFrom', () => {
      const exports = [
        {
          // Flat export comes first
          name: 'ToolbarSeparator',
          reexportedFrom: 'Separator',
          type: { kind: 'component', props: [] },
        },
        {
          // Dotted export comes second
          name: 'Toolbar.Separator',
          reexportedFrom: 'Separator',
          type: { kind: 'component', props: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      // Should prefer the dotted name even though flat came first
      expect(map.get('Separator')).toBe('Toolbar.Separator');
    });
  });

  describe('edge cases', () => {
    it('should return empty map when no exports have reexportedFrom or extendsTypes', () => {
      const exports = [
        {
          name: 'Button',
          type: { kind: 'component', props: [] },
        },
        {
          name: 'Button.Props',
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.size).toBe(0);
    });

    it('should return empty map for empty exports array', () => {
      const map = buildTypeCompatibilityMap([], []);

      expect(map.size).toBe(0);
    });

    it('should handle exports with only reexportedFrom (no extendsTypes)', () => {
      const exports = [
        {
          name: 'MyComponent',
          reexportedFrom: 'BaseComponent',
          type: { kind: 'component', props: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('BaseComponent')).toBe('MyComponent');
      expect(map.size).toBe(1);
    });

    it('should handle exports with only extendsTypes (no reexportedFrom)', () => {
      const exports = [
        {
          name: 'MyComponent.Props',
          extendsTypes: [{ name: 'Base.Props', resolvedName: 'BaseProps' }],
          type: { kind: 'interface', properties: [] },
        },
      ] as any[];

      const map = buildTypeCompatibilityMap(exports, []);

      expect(map.get('Base.Props')).toBe('MyComponent.Props');
      expect(map.get('BaseProps')).toBe('MyComponent.Props');
      expect(map.size).toBe(2);
    });
  });
});

describe('rewriteTypeStringsDeep', () => {
  it('should not double-add namespace when text already has dotted name', () => {
    // This tests the fix for the Toolbar.Toolbar.Separator.State bug
    // When the input already contains "Toolbar.Separator.State", the compat map
    // should not replace "Separator.State" with "ToolbarSeparatorState" because
    // that would then become "Toolbar.Toolbar.Separator.State" after typeNameMap
    const context = {
      typeCompatibilityMap: new Map([
        ['Separator.State', 'ToolbarSeparatorState'],
        ['Separator.Props', 'ToolbarSeparatorProps'],
      ]),
      exportNames: ['Toolbar.Separator', 'Toolbar.Separator.State', 'Toolbar.Separator.Props'],
      typeNameMap: {
        ToolbarSeparator: 'Toolbar.Separator',
        ToolbarSeparatorState: 'Toolbar.Separator.State',
        ToolbarSeparatorProps: 'Toolbar.Separator.Props',
      },
    };

    // Input already has the correct dotted name
    const input = 'string | ((state: Toolbar.Separator.State) => string | undefined)';
    const result = rewriteTypeStringsDeep(input, context);

    // Should NOT become Toolbar.Toolbar.Separator.State
    expect(result).toBe('string | ((state: Toolbar.Separator.State) => string | undefined)');
  });

  it('should still apply compat map when needed', () => {
    // When the input has the old name (e.g., from a component that extends Separator),
    // the compat map should transform it
    const context = {
      typeCompatibilityMap: new Map([['Separator.State', 'ToolbarSeparatorState']]),
      exportNames: ['Toolbar.Separator.State'],
      typeNameMap: {
        ToolbarSeparatorState: 'Toolbar.Separator.State',
      },
    };

    // Input has the OLD name that needs transformation
    const input = 'string | ((state: Separator.State) => string)';
    const result = rewriteTypeStringsDeep(input, context);

    // Should transform to the new dotted name
    expect(result).toBe('string | ((state: Toolbar.Separator.State) => string)');
  });

  it('should apply typeNameMap for flat names', () => {
    const context = {
      typeCompatibilityMap: new Map(),
      exportNames: ['Toolbar.Separator.State'],
      typeNameMap: {
        ToolbarSeparatorState: 'Toolbar.Separator.State',
      },
    };

    const input = 'string | ((state: ToolbarSeparatorState) => string)';
    const result = rewriteTypeStringsDeep(input, context);

    expect(result).toBe('string | ((state: Toolbar.Separator.State) => string)');
  });
});

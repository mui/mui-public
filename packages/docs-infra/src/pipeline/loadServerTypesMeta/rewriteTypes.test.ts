import { describe, it, expect } from 'vitest';
import { buildTypeCompatibilityMap } from './rewriteTypes';

describe('buildTypeCompatibilityMap', () => {
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

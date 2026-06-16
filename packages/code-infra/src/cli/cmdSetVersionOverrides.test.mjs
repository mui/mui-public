import { describe, it, expect } from 'vitest';
import { setOverrides } from './cmdSetVersionOverrides.mjs';

describe('setOverrides', () => {
  describe('writing to pnpm-workspace.yaml', () => {
    it('creates an overrides block in an empty file', () => {
      const result = setOverrides({}, '', { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "overrides:
          foo: 1.2.3
        "
      `);
    });

    it('merges into an existing overrides block while preserving comments', () => {
      const yamlSource = [
        'packages:',
        "  - 'packages/*'",
        'overrides:',
        '  # keep this pin',
        "  bar: '2.0.0'",
        '',
      ].join('\n');

      const result = setOverrides({}, yamlSource, { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "packages:
          - 'packages/*'
        overrides:
          # keep this pin
          bar: '2.0.0'
          foo: 1.2.3
        "
      `);
    });

    it('quotes scoped package names', () => {
      const result = setOverrides({}, '', { '@scope/pkg': '1.0.0' });

      expect(result.workspaceYaml).toContain('"@scope/pkg": 1.0.0');
    });

    it('overwrites a same-named override rather than duplicating it (keeping its quote style)', () => {
      const yamlSource = ['overrides:', "  foo: '1.0.0'", ''].join('\n');

      const result = setOverrides({}, yamlSource, { foo: '2.0.0' });

      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "overrides:
          foo: '2.0.0'
        "
      `);
    });

    it('defaults to the workspace file when neither manifest has overrides', () => {
      const result = setOverrides({ pnpm: {} }, '', { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });

    it('prefers the workspace file when both manifests define overrides', () => {
      const yamlSource = ['overrides:', "  bar: '2.0.0'", ''].join('\n');
      const rootPackageJson = { pnpm: { overrides: { baz: '3.0.0' } } };

      const result = setOverrides(rootPackageJson, yamlSource, { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });
  });

  describe('writing to package.json', () => {
    it('honors the existing package.json location when the workspace file has no overrides', () => {
      const rootPackageJson = {
        name: 'root',
        pnpm: { overrides: { foo: '1.0.0' }, packageExtensions: { thing: {} } },
      };

      const result = setOverrides(rootPackageJson, '', { bar: '2.0.0' });

      expect(result.workspaceYaml).toBeNull();
      expect(result.packageJson).toEqual({
        name: 'root',
        pnpm: {
          overrides: { foo: '1.0.0', bar: '2.0.0' },
          packageExtensions: { thing: {} },
        },
      });
    });

    it('lets computed overrides win over an existing package.json override', () => {
      const rootPackageJson = { pnpm: { overrides: { foo: '1.0.0' } } };

      const result = setOverrides(rootPackageJson, '', { foo: '2.0.0' });

      expect(result.packageJson).toEqual({ pnpm: { overrides: { foo: '2.0.0' } } });
    });
  });

  describe('rejecting resolutions', () => {
    it('throws when package.json has a non-empty resolutions field', () => {
      expect(() => setOverrides({ resolutions: { foo: '1.0.0' } }, '', { bar: '2.0.0' })).toThrow(
        /resolutions/,
      );
    });

    it('ignores an empty resolutions field', () => {
      const result = setOverrides({ resolutions: {} }, '', { foo: '1.2.3' });

      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });
  });
});

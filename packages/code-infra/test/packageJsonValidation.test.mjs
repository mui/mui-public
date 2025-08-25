import { describe, expect, it } from 'vitest';
import { validatePackageJson } from '../src/utils/packageJsonValidation.mjs';

describe('packageJsonValidation', () => {
  describe('validatePackageJson', () => {
    it('should return no warnings for clean package.json', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {},
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should warn about main field', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "main" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about module field', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        module: './dist/index.esm.js',
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "module" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about types field', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        types: './dist/index.d.ts',
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "types" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about exports field', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': './src/index.js',
        },
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "exports" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about multiple overwritable fields', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
        module: './dist/index.esm.js',
        types: './dist/index.d.ts',
        exports: {
          '.': './src/index.js',
        },
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toHaveLength(4);
      expect(result.warnings[0]).toContain('Field "main"');
      expect(result.warnings[1]).toContain('Field "module"');
      expect(result.warnings[2]).toContain('Field "types"');
      expect(result.warnings[3]).toContain('Field "exports"');
      expect(result.errors).toEqual([]);
    });

    it('should return errors when errorOnOverwritable is true', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
        exports: {
          '.': './src/index.js',
        },
      };

      const result = validatePackageJson(packageJson, { errorOnOverwritable: true });

      expect(result.warnings).toEqual([]);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Field "main"');
      expect(result.errors[1]).toContain('Field "exports"');
    });

    it('should not warn about fields that are undefined', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: undefined,
        exports: undefined,
      };

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should not warn about inherited prototype properties', () => {
      const packageJson = Object.create({
        main: './inherited.js',
      });
      packageJson.name = 'test-package';
      packageJson.version = '1.0.0';

      const result = validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });
});

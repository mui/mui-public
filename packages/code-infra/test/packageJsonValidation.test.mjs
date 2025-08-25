import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageJson, lintPackageJson } from '../src/utils/packageJsonValidation.mjs';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

describe('packageJsonValidation', () => {
  let tempDir;

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = path.join(dirname, `temp-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('validatePackageJson', () => {
    it('should return no warnings for clean package.json', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {},
      };

      const result = await validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should warn about main field', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
      };

      const result = await validatePackageJson(packageJson, { checkFileExistence: false });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "main" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about module field', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        module: './dist/index.esm.js',
      };

      const result = await validatePackageJson(packageJson, { checkFileExistence: false });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "module" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about types field', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        types: './dist/index.d.ts',
      };

      const result = await validatePackageJson(packageJson, { checkFileExistence: false });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "types" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about exports field', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': './src/index.js',
        },
      };

      const result = await validatePackageJson(packageJson, { checkFileExistence: false });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "exports" is present in package.json but will be overwritten during build',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about multiple overwritable fields', async () => {
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

      const result = await validatePackageJson(packageJson, { checkFileExistence: false });

      expect(result.warnings).toHaveLength(4);
      expect(result.warnings[0]).toContain('Field "main"');
      expect(result.warnings[1]).toContain('Field "module"');
      expect(result.warnings[2]).toContain('Field "types"');
      expect(result.warnings[3]).toContain('Field "exports"');
      expect(result.errors).toEqual([]);
    });

    it('should return errors when errorOnOverwritable is true', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
        exports: {
          '.': './src/index.js',
        },
      };

      const result = await validatePackageJson(packageJson, {
        errorOnOverwritable: true,
        checkFileExistence: false,
      });

      expect(result.warnings).toEqual([]);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('Field "main"');
      expect(result.errors[1]).toContain('Field "exports"');
    });

    it('should not warn about fields that are undefined', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: undefined,
        exports: undefined,
      };

      const result = await validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should not warn about inherited prototype properties', async () => {
      const packageJson = Object.create({
        main: './inherited.js',
      });
      packageJson.name = 'test-package';
      packageJson.version = '1.0.0';

      const result = await validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should error when private field is not true', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        private: false,
      };

      const result = await validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Field "private" is present but not set to true');
    });

    it('should not error when private field is true', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        private: true,
      };

      const result = await validatePackageJson(packageJson);

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should error when file fields point to non-existent files', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './non-existent.js',
        types: './missing.d.ts',
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(2); // overwritable field warnings
      expect(result.errors).toHaveLength(2); // file existence errors
      expect(result.errors[0]).toContain('File field "main" points to non-existent file');
      expect(result.errors[1]).toContain('File field "types" points to non-existent file');
    });

    it('should not error when file fields point to existing files', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {};');
      await fs.writeFile(path.join(tempDir, 'index.d.ts'), 'export {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './index.js',
        types: './index.d.ts',
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(2); // overwritable field warnings
      expect(result.errors).toEqual([]);
    });

    it('should error when exports point to non-existent files', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': './non-existent.js',
          './utils': './missing-utils.js',
        },
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(1); // overwritable field warning for exports
      expect(result.errors).toHaveLength(2); // file existence errors
      expect(result.errors[0]).toContain(
        'In exports["."]: Export file "./non-existent.js" does not exist',
      );
      expect(result.errors[1]).toContain(
        'In exports["./utils"]: Export file "./missing-utils.js" does not exist',
      );
    });

    it('should not error when exports point to existing files', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {};');
      await fs.writeFile(path.join(tempDir, 'utils.js'), 'module.exports = {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': './index.js',
          './utils': './utils.js',
        },
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(1); // overwritable field warning for exports
      expect(result.errors).toEqual([]);
    });

    it('should handle conditional exports correctly', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'index.mjs'), 'export {};');
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': {
            import: './index.mjs',
            require: './index.js',
          },
        },
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(1); // overwritable field warning for exports
      expect(result.errors).toEqual([]);
    });

    it('should handle glob patterns in exports', async () => {
      // Create test files
      await fs.mkdir(path.join(tempDir, 'components'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'components', 'Button.js'), 'export {};');
      await fs.writeFile(path.join(tempDir, 'components', 'Input.js'), 'export {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          './components/*': './components/*.js',
        },
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(1); // overwritable field warning for exports
      expect(result.errors).toEqual([]);
    });

    it('should error when glob patterns match no files', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          './nonexistent/*': './nonexistent/*.js',
        },
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toHaveLength(1); // overwritable field warning for exports
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Export pattern "./nonexistent/*.js" matches no files');
    });
  });

  describe('lintPackageJson', () => {
    it('should throw error when package.json is missing', async () => {
      await expect(lintPackageJson(tempDir)).rejects.toThrow(
        'Failed to read or parse package.json',
      );
    });

    it('should run validation with allowOverwritableFields false by default', async () => {
      // Create a test file so the main field validation passes
      await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'dist', 'index.js'), 'module.exports = {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
      };

      await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Should run without throwing, but would show warnings
      await expect(lintPackageJson(tempDir, false)).resolves.not.toThrow();
    });

    it('should suppress overwritable field warnings when allowOverwritableFields is true', async () => {
      // Create a test file so the main field validation passes
      await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'dist', 'index.js'), 'module.exports = {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
      };

      await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Should run without throwing or showing warnings
      await expect(lintPackageJson(tempDir, true)).resolves.not.toThrow();
    });

    it('should still show errors even with allowOverwritableFields true', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        private: false, // This should still cause an error
        main: './dist/index.js', // This warning should be suppressed but file error should remain
      };

      await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Should throw because of the private field error and missing file error
      await expect(lintPackageJson(tempDir, true)).rejects.toThrow(
        'Package.json validation failed',
      );
    });
  });
});

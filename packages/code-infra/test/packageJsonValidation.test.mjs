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

    it('should warn about main field when it points to non-existent file', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js', // This file doesn't exist
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "main" points to non-existent file: ./dist/index.js. Consider omitting this field from the source package.json.',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about module field when it points to non-existent file', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        module: './dist/index.esm.js', // This file doesn't exist
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "module" points to non-existent file: ./dist/index.esm.js. Consider omitting this field from the source package.json.',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about types field when it points to non-existent file', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        types: './dist/index.d.ts', // This file doesn't exist
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        'Field "types" points to non-existent file: ./dist/index.d.ts. Consider omitting this field from the source package.json.',
      );
      expect(result.errors).toEqual([]);
    });

    it('should warn about exports field when it points to non-existent files', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        exports: {
          '.': './src/index.js', // This file doesn't exist
        },
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toEqual([]); // no overwritable field warnings
      expect(result.errors).toHaveLength(1); // exports validation error
      expect(result.errors[0]).toContain(
        'In exports["."]: Export file "./src/index.js" does not exist',
      );
    });

    it('should warn about multiple overwritable fields when they point to non-existent files', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js', // doesn't exist
        module: './dist/index.esm.js', // doesn't exist
        types: './dist/index.d.ts', // doesn't exist
        exports: {
          '.': './src/index.js', // doesn't exist
        },
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toHaveLength(3); // only main, module, types warnings
      expect(result.warnings[0]).toContain('Field "main" points to non-existent file');
      expect(result.warnings[1]).toContain('Field "module" points to non-existent file');
      expect(result.warnings[2]).toContain('Field "types" points to non-existent file');
      expect(result.errors).toHaveLength(1); // exports error
      expect(result.errors[0]).toContain(
        'In exports["."]: Export file "./src/index.js" does not exist',
      );
    });

    it('should not warn about overwritable fields when they point to existing files', async () => {
      // Create the files that the fields point to
      await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'dist', 'index.js'), 'module.exports = {};');
      await fs.writeFile(path.join(tempDir, 'src', 'index.js'), 'export {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js', // exists
        exports: {
          '.': './src/index.js', // exists
        },
      };

      const result = await validatePackageJson(packageJson, {
        checkFileExistence: true,
        cwd: tempDir,
      });

      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
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
        typings: './missing.d.ts', // This is a file field that should generate errors
      };

      const result = await validatePackageJson(packageJson, {
        cwd: tempDir,
        checkFileExistence: true,
      });

      expect(result.warnings).toEqual([]); // no overwritable field warnings
      expect(result.errors).toHaveLength(1); // file existence error
      expect(result.errors[0]).toContain('File field "typings" points to non-existent file');
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

      expect(result.warnings).toEqual([]); // no warnings when files exist
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

      expect(result.warnings).toEqual([]); // no overwritable field warnings for exports
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

      expect(result.warnings).toEqual([]); // no warnings when files exist
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

      expect(result.warnings).toEqual([]); // no warnings when files exist
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

      expect(result.warnings).toEqual([]); // no warnings when files exist
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

      expect(result.warnings).toEqual([]); // no overwritable field warnings for exports
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Export pattern "./nonexistent/*.js" matches no files');
    });
  });

  describe('lintPackageJson', () => {
    it('should throw error when validation fails', async () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        private: false, // This should cause an error
      };

      // lintPackageJson should throw when there are validation errors
      await expect(lintPackageJson(packageJson, tempDir)).rejects.toThrow(
        'Package.json validation failed',
      );
    });

    it('should run validation by default', async () => {
      // Create a test file so the main field validation passes
      await fs.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'dist', 'index.js'), 'module.exports = {};');

      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        main: './dist/index.js',
      };

      // Should run without throwing since main field points to existing file
      await expect(lintPackageJson(packageJson, tempDir)).resolves.not.toThrow();
    });
  });
});

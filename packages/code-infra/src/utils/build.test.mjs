import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPackageBin, createPackageExports } from './build.mjs';

/**
 * @param {string} filePath
 * @param {string} [contents]
 */
async function createFile(filePath, contents = '') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

/**
 * @param {(cwd: string) => Promise<void>} fn
 */
async function withTempDir(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-build-test-'));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('createPackageExports', () => {
  it('creates exports for a dual bundle module package', async () => {
    await withTempDir(async (cwd) => {
      const outputDir = path.join(cwd, 'build');
      /**
       * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
       */
      const bundles = [
        { type: 'esm', dir: '.' },
        { type: 'cjs', dir: '.' },
      ];

      await Promise.all([
        createFile(path.join(cwd, 'src/index.ts')),
        createFile(path.join(cwd, 'src/feature.ts')),

        // Create output files for index
        createFile(path.join(outputDir, `index.js`)),
        createFile(path.join(outputDir, `index.cjs`)),
        createFile(path.join(outputDir, `index.d.ts`)),
        createFile(path.join(outputDir, `index.d.cts`)),

        // Create output files for feature
        createFile(path.join(outputDir, `feature.js`)),
        createFile(path.join(outputDir, `feature.cjs`)),
        createFile(path.join(outputDir, `feature.d.ts`)),
        createFile(path.join(outputDir, `feature.d.cts`)),
      ]);

      const {
        exports: packageExports,
        main,
        types,
      } = await createPackageExports({
        exports: {
          '.': './src/index.ts',
          './feature': './src/feature.ts',
        },
        bundles,
        outputDir,
        cwd,
        addTypes: true,
        isFlat: true,
        packageType: 'module',
      });

      expect(main).toBe('./index.cjs');
      expect(types).toBe('./index.d.cts');

      expect(packageExports['.']).toEqual({
        import: { types: './index.d.ts', default: './index.js' },
        require: { types: './index.d.cts', default: './index.cjs' },
        default: {
          types: './index.d.ts',
          default: './index.js',
        },
      });
      expect(packageExports['./feature']).toEqual({
        import: { types: './feature.d.ts', default: './feature.js' },
        require: { types: './feature.d.cts', default: './feature.cjs' },
        default: {
          types: './feature.d.ts',
          default: './feature.js',
        },
      });

      const {
        exports: packageExports2,
        main: main2,
        types: types2,
      } = await createPackageExports({
        exports: {
          '.': './src/index.ts',
          './feature': './src/feature.ts',
        },
        bundles: [bundles[1]], // only CJS bundle
        outputDir,
        cwd,
        addTypes: true,
        isFlat: true,
      });

      expect(main2).toBe('./index.js');
      expect(types2).toBe('./index.d.ts');

      expect(packageExports2['.']).toEqual({
        require: { types: './index.d.ts', default: './index.js' },
        default: {
          types: './index.d.ts',
          default: './index.js',
        },
      });
      expect(packageExports2['./feature']).toEqual({
        require: { types: './feature.d.ts', default: './feature.js' },
        default: {
          types: './feature.d.ts',
          default: './feature.js',
        },
      });
    });
  });

  describe('glob expansion', () => {
    it('expands glob patterns in export keys and values', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/Button.ts')),
          createFile(path.join(cwd, 'src/TextField.ts')),

          // Output files
          createFile(path.join(outputDir, 'Button.js')),
          createFile(path.join(outputDir, 'Button.cjs')),
          createFile(path.join(outputDir, 'Button.d.ts')),
          createFile(path.join(outputDir, 'Button.d.cts')),
          createFile(path.join(outputDir, 'TextField.js')),
          createFile(path.join(outputDir, 'TextField.cjs')),
          createFile(path.join(outputDir, 'TextField.d.ts')),
          createFile(path.join(outputDir, 'TextField.d.cts')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles,
          outputDir,
          cwd,
          addTypes: true,
          isFlat: true,
          packageType: 'module',
        });

        expect(packageExports['./Button']).toEqual({
          import: { types: './Button.d.ts', default: './Button.js' },
          require: { types: './Button.d.cts', default: './Button.cjs' },
          default: { types: './Button.d.ts', default: './Button.js' },
        });
        expect(packageExports['./TextField']).toEqual({
          import: { types: './TextField.d.ts', default: './TextField.js' },
          require: { types: './TextField.d.cts', default: './TextField.cjs' },
          default: { types: './TextField.d.ts', default: './TextField.js' },
        });
        // glob key should not appear in the output
        expect(packageExports['./*']).toBeUndefined();
      });
    });

    it('expands glob with commonjs package type', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/Button.ts')),

          createFile(path.join(outputDir, 'Button.js')),
          createFile(path.join(outputDir, 'Button.mjs')),
          createFile(path.join(outputDir, 'Button.d.ts')),
          createFile(path.join(outputDir, 'Button.d.mts')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles,
          outputDir,
          cwd,
          addTypes: true,
          isFlat: true,
          packageType: 'commonjs',
        });

        expect(packageExports['./Button']).toEqual({
          import: { types: './Button.d.mts', default: './Button.mjs' },
          require: { types: './Button.d.ts', default: './Button.js' },
          default: { types: './Button.d.mts', default: './Button.mjs' },
        });
      });
    });

    it('expands glob with single CJS bundle', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/Button.ts')),

          createFile(path.join(outputDir, 'Button.js')),
          createFile(path.join(outputDir, 'Button.d.ts')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          addTypes: true,
          isFlat: true,
          packageType: 'commonjs',
        });

        expect(packageExports['./Button']).toEqual({
          require: { types: './Button.d.ts', default: './Button.js' },
          default: { types: './Button.d.ts', default: './Button.js' },
        });
      });
    });

    it('expands glob patterns with mui-src object values', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/Alert.ts')),

          createFile(path.join(outputDir, 'Alert.js')),
          createFile(path.join(outputDir, 'Alert.cjs')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': { 'mui-src': './src/*.ts' },
          },
          bundles,
          outputDir,
          cwd,
          isFlat: true,
          packageType: 'module',
        });

        expect(packageExports['./Alert']).toEqual({
          import: './Alert.js',
          require: './Alert.cjs',
          default: './Alert.js',
        });
      });
    });

    it('preserves extra conditions from mui-src object values', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/Alert.ts')),

          createFile(path.join(outputDir, 'Alert.js')),
          createFile(path.join(outputDir, 'Alert.cjs')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': { 'mui-src': './src/*.ts', node: './src/node/*.ts' },
          },
          bundles,
          outputDir,
          cwd,
          isFlat: true,
          packageType: 'module',
        });

        expect(packageExports['./Alert']).toEqual({
          import: { node: './src/node/*.ts', default: './Alert.js' },
          require: { node: './src/node/*.ts', default: './Alert.cjs' },
          default: './Alert.js',
        });
      });
    });

    it('mixes glob and non-glob exports', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/index.ts')),
          createFile(path.join(cwd, 'src/Chip.ts')),

          createFile(path.join(outputDir, 'index.js')),
          createFile(path.join(outputDir, 'index.cjs')),
          createFile(path.join(outputDir, 'Chip.js')),
          createFile(path.join(outputDir, 'Chip.cjs')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            '.': './src/index.ts',
            './*': './src/*.ts',
          },
          bundles,
          outputDir,
          cwd,
          isFlat: true,
          packageType: 'module',
        });

        // Explicit export still works
        expect(packageExports['.']).toBeDefined();
        // Glob-expanded export
        expect(packageExports['./Chip']).toEqual({
          import: './Chip.js',
          require: './Chip.cjs',
          default: './Chip.js',
        });
      });
    });

    it('expands glob with subdirectory pattern', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/utils/color.ts')),
          createFile(path.join(cwd, 'src/utils/size.ts')),

          createFile(path.join(outputDir, 'utils/color.js')),
          createFile(path.join(outputDir, 'utils/color.cjs')),
          createFile(path.join(outputDir, 'utils/size.js')),
          createFile(path.join(outputDir, 'utils/size.cjs')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './utils/*': './src/utils/*.ts',
          },
          bundles,
          outputDir,
          cwd,
          isFlat: true,
          packageType: 'module',
        });

        expect(packageExports['./utils/color']).toEqual({
          import: './utils/color.js',
          require: './utils/color.cjs',
          default: './utils/color.js',
        });
        expect(packageExports['./utils/size']).toEqual({
          import: './utils/size.js',
          require: './utils/size.cjs',
          default: './utils/size.js',
        });
      });
    });

    it('produces no entries when glob matches nothing', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        // Create the src directory but no .ts files in it
        createFile(path.join(cwd, 'src/.gitkeep'));

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        // Only the default ./package.json entry should be present
        expect(Object.keys(packageExports)).toEqual(['./package.json']);
      });
    });

    it('expands globs in sorted order', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/Zebra.ts')),
          createFile(path.join(cwd, 'src/Apple.ts')),
          createFile(path.join(cwd, 'src/Mango.ts')),

          createFile(path.join(outputDir, 'Zebra.js')),
          createFile(path.join(outputDir, 'Apple.js')),
          createFile(path.join(outputDir, 'Mango.js')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        const exportKeys = Object.keys(packageExports).filter((k) => k !== './package.json');
        expect(exportKeys).toEqual(['./Apple', './Mango', './Zebra']);
      });
    });

    it('removes expanded entries matching a null-valued glob (negation)', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');
        /**
         * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
         */
        const bundles = [
          { type: 'esm', dir: '.' },
          { type: 'cjs', dir: '.' },
        ];

        await Promise.all([
          createFile(path.join(cwd, 'src/Accordion.ts')),
          createFile(path.join(cwd, 'src/Button.ts')),
          createFile(path.join(cwd, 'src/ButtonBase.ts')),

          createFile(path.join(outputDir, 'Accordion.js')),
          createFile(path.join(outputDir, 'Accordion.cjs')),
          createFile(path.join(outputDir, 'Button.js')),
          createFile(path.join(outputDir, 'Button.cjs')),
          createFile(path.join(outputDir, 'ButtonBase.js')),
          createFile(path.join(outputDir, 'ButtonBase.cjs')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
            './Button*': null,
          },
          bundles,
          outputDir,
          cwd,
          isFlat: true,
          packageType: 'module',
        });

        expect(packageExports['./Accordion']).toBeDefined();
        expect(packageExports['./Button']).toBeUndefined();
        expect(packageExports['./ButtonBase']).toBeUndefined();
        // The negation glob key itself should not appear
        expect(packageExports['./Button*']).toBeUndefined();
      });
    });

    it('negation with null removes only matching keys', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/Alert.ts')),
          createFile(path.join(cwd, 'src/AlertTitle.ts')),
          createFile(path.join(cwd, 'src/Button.ts')),

          createFile(path.join(outputDir, 'Alert.js')),
          createFile(path.join(outputDir, 'AlertTitle.js')),
          createFile(path.join(outputDir, 'Button.js')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
            './Alert*': null,
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        const exportKeys = Object.keys(packageExports).filter((k) => k !== './package.json');
        expect(exportKeys).toEqual(['./Button']);
      });
    });

    it('preserves null glob pattern when no keys match', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/Button.ts')),
          createFile(path.join(outputDir, 'Button.js')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
            './internal/*': null,
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        // Button is kept since it doesn't match the negation
        expect(packageExports['./Button']).toBeDefined();
        // The negation pattern is preserved as null since nothing matched it
        expect(packageExports['./internal/*']).toBeNull();
      });
    });

    it('does not expand glob patterns when isFlat is false', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/Button.ts')),
          createFile(path.join(cwd, 'src/TextField.ts')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: false,
        });

        // Glob should NOT be expanded to individual files
        expect(packageExports['./Button']).toBeUndefined();
        expect(packageExports['./TextField']).toBeUndefined();
        // The raw glob pattern is passed through as-is
        expect(packageExports['./*']).toEqual({
          require: './*.js',
          default: './*.js',
        });
      });
    });

    it('passes through glob key when value has no wildcard', async () => {
      await withTempDir(async (cwd) => {
        const outputDir = path.join(cwd, 'build');

        await Promise.all([
          createFile(path.join(cwd, 'src/index.ts')),
          createFile(path.join(outputDir, 'index.js')),
        ]);

        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/index.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        // When the value has no *, the glob key is passed through as-is
        expect(packageExports['./*']).toBeDefined();
      });
    });
  });

  it('uses require/import and default for single bundle package', async () => {
    await withTempDir(async (cwd) => {
      const outputDir = path.join(cwd, 'build');

      await Promise.all([
        createFile(path.join(cwd, 'src/index.ts')),
        createFile(path.join(outputDir, 'index.js')),
        createFile(path.join(outputDir, 'index.d.ts')),
      ]);

      const { exports: packageExports } = await createPackageExports({
        exports: {
          '.': './src/index.ts',
        },
        bundles: [{ type: 'cjs', dir: '.' }],
        outputDir,
        cwd,
        addTypes: true,
        isFlat: true,
        packageType: 'commonjs',
      });

      // Single CJS bundle should have both require and default pointing to the same files
      expect(packageExports['.']).toEqual({
        require: {
          types: './index.d.ts',
          default: './index.js',
        },
        default: {
          types: './index.d.ts',
          default: './index.js',
        },
      });
    });
  });
});

describe('createPackageBin', () => {
  it('prefers the ESM bundle when available', async () => {
    await withTempDir(async (cwd) => {
      /**
       * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
       */
      const bundles = [
        { type: 'esm', dir: '.' },
        { type: 'cjs', dir: '.' },
      ];

      await Promise.all([createFile(path.join(cwd, 'src/cli.ts'))]);

      let bin = await createPackageBin({
        bin: './src/cli.ts',
        bundles,
        cwd,
        isFlat: true,
        packageType: 'module',
      });

      expect(bin).toBe('./cli.js');

      bin = await createPackageBin({
        bin: './src/cli.ts',
        bundles: [bundles[1]], // only CJS bundle
        cwd,
        isFlat: true,
      });

      expect(bin).toBe('./cli.js');

      bin = await createPackageBin({
        bin: './src/cli.ts',
        bundles, // only CJS bundle
        cwd,
        isFlat: true,
        packageType: 'commonjs',
      });

      expect(bin).toBe('./cli.mjs');
    });
  });
});

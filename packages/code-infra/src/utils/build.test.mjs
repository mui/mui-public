import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { makeTempDir } from './testUtils.mjs';
import { createPackageBin, createPackageExports, createPackageImports } from './build.mjs';

/**
 * @param {string} filePath
 * @param {string} [contents]
 */
async function createFile(filePath, contents = '') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

describe('createPackageExports', () => {
  it('always puts import before require regardless of bundle array order', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await Promise.all([
      createFile(path.join(cwd, 'src/index.ts')),
      createFile(path.join(cwd, 'src/feature.ts')),
      createFile(path.join(outputDir, 'index.js')),
      createFile(path.join(outputDir, 'index.cjs')),
      createFile(path.join(outputDir, 'feature.js')),
      createFile(path.join(outputDir, 'feature.cjs')),
    ]);

    // Pass cjs before esm to verify the key order is still 'import' then 'require'
    const { exports: packageExports } = await createPackageExports({
      exports: {
        '.': './src/index.ts',
        './feature': './src/feature.ts',
      },
      bundles: [
        { type: 'cjs', dir: '.' },
        { type: 'esm', dir: '.' },
      ],
      outputDir,
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(Object.keys(/** @type {Record<string, unknown>} */ (packageExports['.']))).toEqual([
      'import',
      'require',
      'default',
    ]);
    expect(
      Object.keys(/** @type {Record<string, unknown>} */ (packageExports['./feature'])),
    ).toEqual(['import', 'require', 'default']);
  });

  it('creates exports for a dual bundle module package', async () => {
    const cwd = await makeTempDir();
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

  describe('glob expansion', () => {
    it('expands glob patterns in export keys and values', async () => {
      const cwd = await makeTempDir();
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

    it('expands glob with commonjs package type', async () => {
      const cwd = await makeTempDir();
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

    it('expands glob with single CJS bundle', async () => {
      const cwd = await makeTempDir();
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

    it('rewrites source paths inside sibling conditions when expanding globs', async () => {
      const cwd = await makeTempDir();
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
        createFile(path.join(cwd, 'src/node/Alert.ts')),
      ]);

      const { exports: packageExports } = await createPackageExports({
        exports: {
          './*': { node: './src/node/*.ts', default: './src/*.ts' },
        },
        bundles,
        outputDir,
        cwd,
        isFlat: true,
        packageType: 'module',
      });

      // Every condition's source path is rewritten (no verbatim `./src/...`),
      // and conditions stay outer with the import/require split at the leaves.
      expect(packageExports['./Alert']).toEqual({
        node: {
          import: './node/Alert.js',
          require: './node/Alert.cjs',
          default: './node/Alert.js',
        },
        default: {
          import: './Alert.js',
          require: './Alert.cjs',
          default: './Alert.js',
        },
      });
    });

    it('omits a sibling condition for stems its glob does not match', async () => {
      const cwd = await makeTempDir();
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
        createFile(path.join(cwd, 'src/Button.ts')),
        // Only Alert has a node variant.
        createFile(path.join(cwd, 'src/node/Alert.ts')),
      ]);

      const { exports: packageExports } = await createPackageExports({
        exports: {
          './*': { node: './src/node/*.ts', default: './src/*.ts' },
        },
        bundles,
        outputDir,
        cwd,
        isFlat: true,
        packageType: 'module',
      });

      // Alert keeps its node condition.
      expect(packageExports['./Alert']).toEqual({
        node: {
          import: './node/Alert.js',
          require: './node/Alert.cjs',
          default: './node/Alert.js',
        },
        default: { import: './Alert.js', require: './Alert.cjs', default: './Alert.js' },
      });
      // Button has no node variant, so the node condition is dropped rather than
      // pointing at a non-existent source (which would fail the build).
      expect(packageExports['./Button']).toEqual({
        default: { import: './Button.js', require: './Button.cjs', default: './Button.js' },
      });
    });

    it('enumerates a wildcard directory pattern', async () => {
      const cwd = await makeTempDir();
      const outputDir = path.join(cwd, 'build');

      await Promise.all([
        createFile(path.join(cwd, 'src/tabs/script.ts')),
        createFile(path.join(cwd, 'src/menu/script.ts')),
      ]);

      const { exports: packageExports } = await createPackageExports({
        exports: {
          './*': './src/*/script.ts',
        },
        bundles: [{ type: 'cjs', dir: '.' }],
        outputDir,
        cwd,
        isFlat: true,
      });

      expect(packageExports['./tabs']).toEqual({
        require: './tabs/script.js',
        default: './tabs/script.js',
      });
      expect(packageExports['./menu']).toEqual({
        require: './menu/script.js',
        default: './menu/script.js',
      });
    });

    it('warns and produces nothing when a glob matches no files', async () => {
      const cwd = await makeTempDir();
      const outputDir = path.join(cwd, 'build');
      createFile(path.join(cwd, 'src/.gitkeep'));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { exports: packageExports } = await createPackageExports({
          exports: {
            './*': './src/*.ts',
          },
          bundles: [{ type: 'cjs', dir: '.' }],
          outputDir,
          cwd,
          isFlat: true,
        });

        expect(Object.keys(packageExports)).toEqual(['./package.json']);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('mixes glob and non-glob exports', async () => {
      const cwd = await makeTempDir();
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

    it('expands glob with subdirectory pattern', async () => {
      const cwd = await makeTempDir();
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

    it('produces no entries when glob matches nothing', async () => {
      const cwd = await makeTempDir();
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

    it('expands globs in sorted order', async () => {
      const cwd = await makeTempDir();
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

    it('removes expanded entries matching a null-valued glob (negation)', async () => {
      const cwd = await makeTempDir();
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

    it('negation with null removes only matching keys', async () => {
      const cwd = await makeTempDir();
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

    it('preserves null glob pattern when no keys match', async () => {
      const cwd = await makeTempDir();
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

    it('does not expand glob patterns when expand is false', async () => {
      const cwd = await makeTempDir();
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
        expand: false,
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

    it('passes through glob key when value has no wildcard', async () => {
      const cwd = await makeTempDir();
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

  it('uses require/import and default for single bundle package', async () => {
    const cwd = await makeTempDir();
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

describe('createPackageExports leaf rewriting', () => {
  it('rewrites a standard conditions object (conditions-outer)', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');
    /**
     * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
     */
    const bundles = [
      { type: 'esm', dir: '.' },
      { type: 'cjs', dir: '.' },
    ];

    await Promise.all([
      createFile(path.join(cwd, 'src/feature.ts')),
      createFile(path.join(cwd, 'src/node/feature.ts')),
    ]);

    const { exports: packageExports } = await createPackageExports({
      exports: {
        './feature': { node: './src/node/feature.ts', default: './src/feature.ts' },
      },
      bundles,
      outputDir,
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(packageExports['./feature']).toEqual({
      node: {
        import: './node/feature.js',
        require: './node/feature.cjs',
        default: './node/feature.js',
      },
      default: {
        import: './feature.js',
        require: './feature.cjs',
        default: './feature.js',
      },
    });
  });

  it('passes through paths that are not under src/ verbatim', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await Promise.all([
      createFile(path.join(outputDir, 'assets/logo.svg')),
      createFile(path.join(outputDir, 'vendor/legacy.js')),
    ]);

    const { exports: packageExports } = await createPackageExports({
      exports: {
        './logo': './assets/logo.svg',
        './legacy': './vendor/legacy.js',
      },
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
    });

    // Already present in the published output: emitted unchanged.
    expect(packageExports['./logo']).toBe('./assets/logo.svg');
    expect(packageExports['./legacy']).toBe('./vendor/legacy.js');
  });

  it('treats src/ without a leading ./ as a source path', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await createFile(path.join(cwd, 'src/index.ts'));

    const { exports: packageExports } = await createPackageExports({
      exports: {
        './entry': 'src/index.ts',
      },
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
    });

    expect(packageExports['./entry']).toEqual({
      require: './index.js',
      default: './index.js',
    });
  });

  it('rewrites the prefix of a non-JS asset under src/ without an extension swap', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await createFile(path.join(cwd, 'src/theme.css'));

    const { exports: packageExports } = await createPackageExports({
      exports: {
        './theme.css': './src/theme.css',
      },
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
    });

    expect(packageExports['./theme.css']).toBe('./theme.css');
  });

  it('preserves a user-authored default alongside import/require conditions', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');
    /**
     * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
     */
    const bundles = [
      { type: 'esm', dir: '.' },
      { type: 'cjs', dir: '.' },
    ];

    await Promise.all([
      createFile(path.join(cwd, 'src/esm.ts')),
      createFile(path.join(cwd, 'src/fallback.ts')),
    ]);

    const { exports: packageExports } = await createPackageExports({
      exports: {
        './x': { import: './src/esm.ts', default: './src/fallback.ts' },
      },
      bundles,
      outputDir,
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    // The synthesized default must not clobber the user's `default` branch.
    expect(packageExports['./x']).toEqual({
      import: { import: './esm.js', require: './esm.cjs', default: './esm.js' },
      default: { import: './fallback.js', require: './fallback.cjs', default: './fallback.js' },
    });
  });
});

describe('createPackageExports resolution semantics', () => {
  /**
   * Seeds the worked example with files so the shallow and deep patterns match.
   * @param {string} cwd
   */
  async function seedWorkedExample(cwd) {
    await Promise.all([
      createFile(path.join(cwd, 'src/foo/x.ts')),
      createFile(path.join(cwd, 'src/foo/bar/baz/z.ts')),
    ]);
  }

  const workedExampleExports = {
    './foo/*': './src/foo/*.ts',
    './foo/bar/*': null,
    './foo/bar/baz/*': './src/foo/bar/baz/*.ts',
  };

  it('enumerates with Node-faithful, non-cascading negation (expand: true)', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');
    await seedWorkedExample(cwd);

    const { exports: packageExports } = await createPackageExports({
      exports: workedExampleExports,
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
    });

    // ./foo/x resolves (matched only by the shallow pattern)
    expect(packageExports['./foo/x']).toEqual({
      require: './foo/x.js',
      default: './foo/x.js',
    });
    // ./foo/bar/baz/z resolves even though it sits under the null'd ./foo/bar/*
    expect(packageExports['./foo/bar/baz/z']).toEqual({
      require: './foo/bar/baz/z.js',
      default: './foo/bar/baz/z.js',
    });
    // nothing whose most-specific match is the null is emitted as a concrete entry
    expect(packageExports['./foo/bar/z']).toBeUndefined();
    // the null pattern is carried through to keep blocking its subtree at runtime
    expect(packageExports['./foo/bar/*']).toBeNull();
  });

  it('keeps patterns and the null verbatim (expand: false)', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');
    await seedWorkedExample(cwd);

    const { exports: packageExports } = await createPackageExports({
      exports: workedExampleExports,
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
      expand: false,
    });

    expect(packageExports['./foo/*']).toEqual({
      require: './foo/*.js',
      default: './foo/*.js',
    });
    expect(packageExports['./foo/bar/baz/*']).toEqual({
      require: './foo/bar/baz/*.js',
      default: './foo/bar/baz/*.js',
    });
    expect(packageExports['./foo/bar/*']).toBeNull();
  });

  it('lets an exact key win over a matching pattern', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await Promise.all([
      createFile(path.join(cwd, 'src/Other.ts')),
      createFile(path.join(cwd, 'src/override.ts')),
    ]);

    const { exports: packageExports } = await createPackageExports({
      exports: {
        // Exact key collides with what `./*` would expand to, but points elsewhere.
        './Other': './src/override.ts',
        './*': './src/*.ts',
      },
      bundles: [{ type: 'cjs', dir: '.' }],
      outputDir,
      cwd,
      isFlat: true,
    });

    // The exact key keeps its own target rather than the pattern's stem.
    expect(packageExports['./Other']).toEqual({
      require: './override.js',
      default: './override.js',
    });
    // The pattern still expands its other matches.
    expect(packageExports['./override']).toEqual({
      require: './override.js',
      default: './override.js',
    });
  });
});

describe('createPackageBin', () => {
  it('prefers the ESM bundle when available', async () => {
    const cwd = await makeTempDir();
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

describe('createPackageImports', () => {
  it('returns undefined when there is no imports field', async () => {
    const cwd = await makeTempDir();

    const imports = await createPackageImports({
      imports: undefined,
      bundles: [{ type: 'esm', dir: '.' }],
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(imports).toBeUndefined();
  });

  it('throws when an import key does not start with "#"', async () => {
    const cwd = await makeTempDir();

    await expect(
      createPackageImports({
        imports: /** @type {any} */ ({
          'internal/utils': './src/internal/utils.ts',
        }),
        bundles: [{ type: 'esm', dir: '.' }],
        cwd,
        isFlat: true,
        packageType: 'module',
      }),
    ).rejects.toThrow('must start with "#"');
  });

  it('rewrites internal subpath imports for a dual bundle module package', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');
    /**
     * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
     */
    const bundles = [
      { type: 'esm', dir: '.' },
      { type: 'cjs', dir: '.' },
    ];

    await Promise.all([
      createFile(path.join(cwd, 'src/internal/utils.ts')),
      createFile(path.join(outputDir, 'internal/utils.js')),
      createFile(path.join(outputDir, 'internal/utils.cjs')),
      createFile(path.join(outputDir, 'internal/utils.d.ts')),
      createFile(path.join(outputDir, 'internal/utils.d.cts')),
    ]);

    const imports = await createPackageImports({
      imports: {
        '#internal/utils': './src/internal/utils.ts',
      },
      bundles,
      cwd,
      addTypes: true,
      isFlat: true,
      packageType: 'module',
    });

    expect(imports).toEqual({
      '#internal/utils': {
        import: { types: './internal/utils.d.ts', default: './internal/utils.js' },
        require: { types: './internal/utils.d.cts', default: './internal/utils.cjs' },
        default: { types: './internal/utils.d.ts', default: './internal/utils.js' },
      },
    });
  });

  it('puts import before require regardless of bundle array order', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await Promise.all([
      createFile(path.join(cwd, 'src/internal/utils.ts')),
      createFile(path.join(outputDir, 'internal/utils.js')),
      createFile(path.join(outputDir, 'internal/utils.cjs')),
    ]);

    const imports = await createPackageImports({
      imports: {
        '#internal/utils': './src/internal/utils.ts',
      },
      // Pass cjs before esm to verify the key order is still 'import' then 'require'
      bundles: [
        { type: 'cjs', dir: '.' },
        { type: 'esm', dir: '.' },
      ],
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(
      Object.keys(/** @type {Record<string, unknown>} */ (imports?.['#internal/utils'])),
    ).toEqual(['import', 'require', 'default']);
  });

  it('passes bare specifiers through unchanged', async () => {
    const cwd = await makeTempDir();

    const imports = await createPackageImports({
      imports: {
        '#error-formatter': '@custom/error-formatter',
      },
      bundles: [
        { type: 'esm', dir: '.' },
        { type: 'cjs', dir: '.' },
      ],
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(imports).toEqual({
      '#error-formatter': '@custom/error-formatter',
    });
  });

  it('expands glob patterns in import keys and values', async () => {
    const cwd = await makeTempDir();
    const outputDir = path.join(cwd, 'build');

    await Promise.all([
      createFile(path.join(cwd, 'src/internal/foo.ts')),
      createFile(path.join(cwd, 'src/internal/bar.ts')),
      createFile(path.join(outputDir, 'internal/foo.js')),
      createFile(path.join(outputDir, 'internal/bar.js')),
    ]);

    const imports = await createPackageImports({
      imports: {
        '#internal/*': './src/internal/*.ts',
      },
      bundles: [{ type: 'esm', dir: '.' }],
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(imports).toEqual({
      '#internal/bar': { import: './internal/bar.js', default: './internal/bar.js' },
      '#internal/foo': { import: './internal/foo.js', default: './internal/foo.js' },
    });
  });

  it('rewrites every condition of a conditions object (conditions-outer)', async () => {
    const cwd = await makeTempDir();
    /**
     * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
     */
    const bundles = [
      { type: 'esm', dir: '.' },
      { type: 'cjs', dir: '.' },
    ];

    await Promise.all([
      createFile(path.join(cwd, 'src/internal/utils.ts')),
      createFile(path.join(cwd, 'src/internal/node/utils.ts')),
    ]);

    const imports = await createPackageImports({
      imports: {
        '#internal/utils': {
          node: './src/internal/node/utils.ts',
          default: './src/internal/utils.ts',
        },
      },
      bundles,
      cwd,
      isFlat: true,
      packageType: 'module',
    });

    expect(imports).toEqual({
      '#internal/utils': {
        node: {
          import: './internal/node/utils.js',
          require: './internal/node/utils.cjs',
          default: './internal/node/utils.js',
        },
        default: {
          import: './internal/utils.js',
          require: './internal/utils.cjs',
          default: './internal/utils.js',
        },
      },
    });
  });
});

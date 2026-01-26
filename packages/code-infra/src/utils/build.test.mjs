import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPackageBin, createPackageExports, getOutExtension } from './build.mjs';

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

      await createFile(path.join(cwd, 'src/index.ts'));
      await createFile(path.join(cwd, 'src/feature.ts'));

      // Create output files for index
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('esm', { isFlat: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('cjs', { isFlat: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('esm', { isFlat: true, isType: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('cjs', { isFlat: true, isType: true, packageType: 'module' })}`,
        ),
      );

      // Create output files for feature
      await createFile(
        path.join(
          outputDir,
          `feature${getOutExtension('esm', { isFlat: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `feature${getOutExtension('cjs', { isFlat: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `feature${getOutExtension('esm', { isFlat: true, isType: true, packageType: 'module' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `feature${getOutExtension('cjs', { isFlat: true, isType: true, packageType: 'module' })}`,
        ),
      );

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

  it('uses require/import and default for single bundle package', async () => {
    await withTempDir(async (cwd) => {
      const outputDir = path.join(cwd, 'build');

      await createFile(path.join(cwd, 'src/index.ts'));
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('cjs', { isFlat: true, packageType: 'commonjs' })}`,
        ),
      );
      await createFile(
        path.join(
          outputDir,
          `index${getOutExtension('cjs', { isFlat: true, isType: true, packageType: 'commonjs' })}`,
        ),
      );

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
  it('uses the bundle matching the package type', async () => {
    await withTempDir(async (cwd) => {
      /**
       * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
       */
      const bundles = [
        { type: 'esm', dir: '.' },
        { type: 'cjs', dir: '.' },
      ];

      await createFile(path.join(cwd, 'src/cli.ts'));

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

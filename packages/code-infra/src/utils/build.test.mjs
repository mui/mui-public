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
    });
  });

  it('collapses to default for a single bundle', async () => {
    await withTempDir(async (cwd) => {
      const outputDir = path.join(cwd, 'build');
      /**
       * @type {{ type: import('./build.mjs').BundleType; dir: string }[]}
       */
      const bundles = [{ type: 'cjs', dir: '.' }];

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
        bundles,
        outputDir,
        cwd,
        addTypes: true,
        isFlat: true,
        packageType: 'commonjs',
      });

      expect(packageExports['.']).toEqual({
        types: './index.d.ts',
        default: './index.js',
      });
      const rootExport = /** @type {Record<string, unknown>} */ (packageExports['.']);
      expect(rootExport.import).toBeUndefined();
      expect(rootExport.require).toBeUndefined();
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

      const bin = await createPackageBin({
        bin: './src/cli.ts',
        bundles,
        cwd,
        isFlat: true,
        packageType: 'module',
      });

      expect(bin).toBe('./cli.js');
    });
  });
});

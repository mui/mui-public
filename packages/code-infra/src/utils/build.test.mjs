import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createPackageBin,
  createPackageExports,
  createSubdirectoryPackageJsons,
  getOutExtension,
} from './build.mjs';

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

describe('createSubdirectoryPackageJsons', () => {
  it('creates package.json files for entrypoint subdirectories', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');
      await fs.mkdir(baseOutDir, { recursive: true });

      const transformedExports = {
        './package.json': './package.json',
        '.': {
          import: { types: './index.d.mts', default: './index.mjs' },
          require: { types: './index.d.ts', default: './index.js' },
          default: { types: './index.d.mts', default: './index.mjs' },
        },
        './ButtonBase/TouchRipple': {
          import: {
            types: './ButtonBase/TouchRipple.d.mts',
            default: './ButtonBase/TouchRipple.mjs',
          },
          require: {
            types: './ButtonBase/TouchRipple.d.ts',
            default: './ButtonBase/TouchRipple.js',
          },
          default: {
            types: './ButtonBase/TouchRipple.d.mts',
            default: './ButtonBase/TouchRipple.mjs',
          },
        },
        './*': {
          import: { types: './*/index.d.mts', default: './*/index.mjs' },
          require: { types: './*/index.d.ts', default: './*/index.js' },
          default: { types: './*/index.d.mts', default: './*/index.mjs' },
        },
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      // Check that package.json was created for ButtonBase/TouchRipple
      const pkgJsonPath = path.join(baseOutDir, 'ButtonBase/TouchRipple/package.json');
      const pkgJsonExists = await fs.stat(pkgJsonPath).then(
        (stats) => stats.isFile(),
        () => false,
      );

      expect(pkgJsonExists).toBe(true);

      const pkgJsonContent = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));

      // Paths should be relative from ButtonBase/TouchRipple/ to the actual files
      // From ButtonBase/TouchRipple/ to ButtonBase/TouchRipple.js is ../TouchRipple.js
      expect(pkgJsonContent).toEqual({
        main: '../TouchRipple.js',
        types: '../TouchRipple.d.ts',
        module: '../TouchRipple.mjs',
      });
    });
  });

  it('skips special exports when no matching directories exist', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');
      await fs.mkdir(baseOutDir, { recursive: true });

      const transformedExports = {
        './package.json': './package.json',
        '.': {
          import: { types: './index.d.mts', default: './index.mjs' },
        },
        './*': {
          import: { types: './*/index.d.mts', default: './*/index.mjs' },
        },
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      // Check that no subdirectory package.jsons were created since no directories exist
      const files = await fs.readdir(baseOutDir);
      expect(files.length).toBe(0);
    });
  });

  it('handles wildcard exports for existing subdirectories', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');

      // Create some subdirectories
      await fs.mkdir(path.join(baseOutDir, 'Button'), { recursive: true });
      await fs.mkdir(path.join(baseOutDir, 'TextField'), { recursive: true });

      const transformedExports = {
        './*': {
          import: { types: './*/index.d.mts', default: './*/index.mjs' },
          require: { types: './*/index.d.ts', default: './*/index.js' },
        },
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      // Check that package.json was created for Button
      const buttonPkgPath = path.join(baseOutDir, 'Button/package.json');
      const buttonPkgExists = await fs.stat(buttonPkgPath).then(
        (stats) => stats.isFile(),
        () => false,
      );
      expect(buttonPkgExists).toBe(true);

      const buttonPkgContent = JSON.parse(await fs.readFile(buttonPkgPath, 'utf-8'));
      expect(buttonPkgContent).toEqual({
        main: './index.js',
        types: './index.d.ts',
        module: './index.mjs',
      });

      // Check that package.json was created for TextField
      const textFieldPkgPath = path.join(baseOutDir, 'TextField/package.json');
      const textFieldPkgExists = await fs.stat(textFieldPkgPath).then(
        (stats) => stats.isFile(),
        () => false,
      );
      expect(textFieldPkgExists).toBe(true);

      const textFieldPkgContent = JSON.parse(await fs.readFile(textFieldPkgPath, 'utf-8'));
      expect(textFieldPkgContent).toEqual({
        main: './index.js',
        types: './index.d.ts',
        module: './index.mjs',
      });
    });
  });

  it('handles wildcard exports with prefix pattern', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');

      // Create subdirectories under components
      await fs.mkdir(path.join(baseOutDir, 'components/Button'), { recursive: true });
      await fs.mkdir(path.join(baseOutDir, 'components/Input'), { recursive: true });

      const transformedExports = {
        './components/*': {
          import: { types: './components/*/index.d.mts', default: './components/*/index.mjs' },
          require: { types: './components/*/index.d.ts', default: './components/*/index.js' },
        },
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      // Check Button
      const buttonPkgPath = path.join(baseOutDir, 'components/Button/package.json');
      const buttonPkgExists = await fs.stat(buttonPkgPath).then(
        (stats) => stats.isFile(),
        () => false,
      );
      expect(buttonPkgExists).toBe(true);

      const buttonPkgContent = JSON.parse(await fs.readFile(buttonPkgPath, 'utf-8'));
      expect(buttonPkgContent).toEqual({
        main: './index.js',
        types: './index.d.ts',
        module: './index.mjs',
      });

      // Check Input
      const inputPkgPath = path.join(baseOutDir, 'components/Input/package.json');
      const inputPkgExists = await fs.stat(inputPkgPath).then(
        (stats) => stats.isFile(),
        () => false,
      );
      expect(inputPkgExists).toBe(true);

      const inputPkgContent = JSON.parse(await fs.readFile(inputPkgPath, 'utf-8'));
      expect(inputPkgContent).toEqual({
        main: './index.js',
        types: './index.d.ts',
        module: './index.mjs',
      });
    });
  });

  it('handles null exports gracefully', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');
      await fs.mkdir(baseOutDir, { recursive: true });

      const transformedExports = {
        './subpath': null,
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      // Should not throw and should not create any files
      const files = await fs.readdir(baseOutDir);
      expect(files.length).toBe(0);
    });
  });

  it('handles nested subdirectory paths correctly', async () => {
    await withTempDir(async (tmpDir) => {
      const baseOutDir = path.join(tmpDir, 'build');
      await fs.mkdir(baseOutDir, { recursive: true });

      const transformedExports = {
        './components/Button/ButtonBase': {
          import: {
            types: './components/Button/ButtonBase.d.mts',
            default: './components/Button/ButtonBase.mjs',
          },
          require: {
            types: './components/Button/ButtonBase.d.ts',
            default: './components/Button/ButtonBase.js',
          },
        },
      };

      await createSubdirectoryPackageJsons(transformedExports, { baseOutDir });

      const pkgJsonPath = path.join(baseOutDir, 'components/Button/ButtonBase/package.json');
      const pkgJsonExists = await fs.stat(pkgJsonPath).then(
        (stats) => stats.isFile(),
        () => false,
      );

      expect(pkgJsonExists).toBe(true);

      const pkgJsonContent = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));

      // From components/Button/ButtonBase/ to components/Button/ButtonBase.js is ../ButtonBase.js
      expect(pkgJsonContent).toEqual({
        main: '../ButtonBase.js',
        types: '../ButtonBase.d.ts',
        module: '../ButtonBase.mjs',
      });
    });
  });
});

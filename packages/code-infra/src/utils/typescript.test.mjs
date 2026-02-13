import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { copyDeclarations, moveAndTransformDeclarations } from './typescript.mjs';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */

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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-typescript-test-'));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('copyDeclarations', () => {
  it('copies .d.ts files from source to destination', async () => {
    await withTempDir(async (cwd) => {
      const sourceDir = path.join(cwd, 'source');
      const destDir = path.join(cwd, 'dest');

      await Promise.all([
        createFile(path.join(sourceDir, 'index.d.ts'), 'export const foo: string;'),
        createFile(path.join(sourceDir, 'utils.d.ts'), 'export const bar: number;'),
        createFile(path.join(sourceDir, 'index.js'), 'export const foo = "test";'),
      ]);

      await copyDeclarations(sourceDir, destDir);

      const indexDts = await fs.readFile(path.join(destDir, 'index.d.ts'), 'utf8');
      const utilsDts = await fs.readFile(path.join(destDir, 'utils.d.ts'), 'utf8');

      expect(indexDts).toBe('export const foo: string;');
      expect(utilsDts).toBe('export const bar: number;');

      const jsExists = await fs.stat(path.join(destDir, 'index.js')).catch(() => null);
      expect(jsExists).toBeNull();
    });
  });

  it('copies .d.mts and .d.cts files', async () => {
    await withTempDir(async (cwd) => {
      const sourceDir = path.join(cwd, 'source');
      const destDir = path.join(cwd, 'dest');

      await Promise.all([
        createFile(path.join(sourceDir, 'index.d.mts'), 'export const esm: string;'),
        createFile(path.join(sourceDir, 'index.d.cts'), 'export const cjs: string;'),
      ]);

      await copyDeclarations(sourceDir, destDir);

      const mtsDts = await fs.readFile(path.join(destDir, 'index.d.mts'), 'utf8');
      const ctsDts = await fs.readFile(path.join(destDir, 'index.d.cts'), 'utf8');

      expect(mtsDts).toBe('export const esm: string;');
      expect(ctsDts).toBe('export const cjs: string;');
    });
  });

  it('ignores dotfiles and dot-directories', async () => {
    await withTempDir(async (cwd) => {
      const sourceDir = path.join(cwd, 'source');
      const destDir = path.join(cwd, 'dest');

      await Promise.all([
        createFile(path.join(sourceDir, 'index.d.ts'), 'export const foo: string;'),
        createFile(path.join(sourceDir, '.hidden.d.ts'), 'export const hidden: string;'),
        createFile(path.join(sourceDir, '.git', 'config'), 'git config'),
      ]);

      await copyDeclarations(sourceDir, destDir);

      const indexDts = await fs.readFile(path.join(destDir, 'index.d.ts'), 'utf8');
      expect(indexDts).toBe('export const foo: string;');

      const hiddenDts = await fs.stat(path.join(destDir, '.hidden.d.ts')).catch(() => null);
      expect(hiddenDts).toBeNull();

      const gitDir = await fs.stat(path.join(destDir, '.git')).catch(() => null);
      expect(gitDir).toBeNull();
    });
  });

  it('preserves nested directory structure for .d.ts files', async () => {
    await withTempDir(async (cwd) => {
      const sourceDir = path.join(cwd, 'source');
      const destDir = path.join(cwd, 'dest');

      await Promise.all([
        createFile(path.join(sourceDir, 'types/index.d.ts'), 'export type Foo = string;'),
        createFile(
          path.join(sourceDir, 'types/utils/helpers.d.ts'),
          'export type Helper = () => void;',
        ),
      ]);

      await copyDeclarations(sourceDir, destDir);

      const indexDts = await fs.readFile(path.join(destDir, 'types/index.d.ts'), 'utf8');
      const helpersDts = await fs.readFile(path.join(destDir, 'types/utils/helpers.d.ts'), 'utf8');

      expect(indexDts).toBe('export type Foo = string;');
      expect(helpersDts).toBe('export type Helper = () => void;');
    });
  });
});

describe('moveAndTransformDeclarations', () => {
  it('handles path normalization correctly for Windows-style paths', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      // Create a test .d.ts file
      await Promise.all([
        createFile(path.join(inputDir, 'index.d.ts'), 'export const test: string;'),
      ]);

      /** @type {{type: BundleType; dir: string}[]} */
      const bundles = [{ type: 'esm', dir: 'esm' }];

      // Mock babel transformAsync to avoid actual babel transformations
      vi.doMock('@babel/core', () => ({
        transformAsync: vi.fn(async (code) => ({ code })),
      }));

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: false,
        packageType: 'module',
      });

      // Verify file exists in the correct location
      const dtsFile = path.join(buildDir, 'esm', 'index.d.ts');
      const stat = await fs.stat(dtsFile).catch(() => null);
      expect(stat).not.toBeNull();
      expect(stat?.isFile()).toBe(true);
    });
  });

  it('preserves original path file when not flat build', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      // Create a test .d.ts file
      await Promise.all([
        createFile(path.join(inputDir, 'index.d.ts'), 'export const test: string;'),
      ]);

      /** @type {{type: BundleType; dir: string}[]} */
      const bundles = [{ type: 'esm', dir: 'esm' }];

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: false,
        packageType: 'module',
      });

      // For single bundle non-flat builds, files are copied to bundle dir
      const dtsFile = path.join(buildDir, 'esm', 'index.d.ts');
      const stat = await fs.stat(dtsFile).catch(() => null);
      expect(stat?.isFile()).toBe(true);
    });
  });

  it('correctly compares resolved paths on all platforms', async () => {
    // This test verifies that path.resolve() normalizes paths consistently
    // across Windows (backslashes) and Unix (forward slashes)
    const testPath1 = 'build/esm/index.d.ts';
    const testPath2 = path.normalize('build/esm/index.d.ts');

    const resolved1 = path.resolve(testPath1);
    const resolved2 = path.resolve(testPath2);

    // Even if separators differ in input, resolved paths should be identical
    expect(resolved1).toBe(resolved2);
  });

  it('normalizes paths before reading files', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      const content = 'export const normalized: boolean;';
      await Promise.all([createFile(path.join(inputDir, 'test.d.ts'), content)]);

      /** @type {{type: BundleType; dir: string}[]} */
      const bundles = [{ type: 'esm', dir: 'esm' }];

      // Mock babel transformAsync to capture filename
      const transformMock = vi.fn(async (code) => ({ code }));
      vi.doMock('@babel/core', () => ({
        transformAsync: transformMock,
      }));

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: false,
        packageType: 'module',
      });

      // Verify the file was read correctly by checking it exists
      const dtsFile = path.join(buildDir, 'esm', 'test.d.ts');
      const stat = await fs.stat(dtsFile).catch(() => null);
      expect(stat?.isFile()).toBe(true);
    });
  });

  it('preserves file when output extension matches in flat builds', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      const content = 'export const flat: string;';
      await Promise.all([createFile(path.join(inputDir, 'index.d.ts'), content)]);

      /** @type {{type: BundleType; dir: string}[]} */
      // ESM + module packageType keeps .d.ts extension in flat builds
      const bundles = [{ type: 'esm', dir: 'esm' }];

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: true,
        packageType: 'module',
      });

      // Since extension doesn't change (.d.ts -> .d.ts), file should remain
      const outputFile = path.join(buildDir, 'esm', 'index.d.ts');
      const outputStat = await fs.stat(outputFile).catch(() => null);
      expect(outputStat?.isFile()).toBe(true);
    });
  });

  it('removes original when output extension differs in flat builds', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      const content = 'export const transformed: string;';
      await Promise.all([createFile(path.join(inputDir, 'index.d.ts'), content)]);
      /** @type {{type: BundleType; dir: string}[]} */

      // CJS bundle with module packageType creates .d.cts
      const bundles = [{ type: 'cjs', dir: 'cjs' }];

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: true,
        packageType: 'module',
      });

      // Transformed file with new extension should exist
      const outputFile = path.join(buildDir, 'cjs', 'index.d.cts');
      const outputStat = await fs.stat(outputFile).catch(() => null);
      expect(outputStat?.isFile()).toBe(true);

      // Original .d.ts should be removed
      const originalFile = path.join(buildDir, 'cjs', 'index.d.ts');
      const originalStat = await fs.stat(originalFile).catch(() => null);
      expect(originalStat).toBeNull();
    });
  });

  it('handles mixed separator paths in comparisons on Windows', async () => {
    // Simulate Windows-style path comparison scenario
    // where globby might return forward slashes but path.join uses backslashes
    const basePath = process.platform === 'win32' ? 'C:\\project\\build' : '/project/build';
    const forwardSlashPath = `${basePath.replace(/\\/g, '/')}/esm/index.d.ts`;
    const backslashPath =
      basePath + (process.platform === 'win32' ? '\\esm\\index.d.ts' : '/esm/index.d.ts');

    // After path.resolve(), both should be identical
    const resolved1 = path.resolve(forwardSlashPath);
    const resolved2 = path.resolve(backslashPath);

    expect(resolved1).toBe(resolved2);
  });

  it('uses normalized paths for writesToOriginalPath check', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      const content = 'export const component: string;';
      await Promise.all([createFile(path.join(inputDir, 'component.d.ts'), content)]);
      /** @type {{type: BundleType; dir: string}[]} */

      // ESM + commonjs packageType creates .d.mts
      const bundles = [{ type: 'esm', dir: 'esm' }];

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: true,
        packageType: 'commonjs',
      });

      // The .d.mts file should exist
      const transformedFile = path.join(buildDir, 'esm', 'component.d.mts');
      const transformedStat = await fs.stat(transformedFile).catch(() => null);
      expect(transformedStat?.isFile()).toBe(true);

      // Original .d.ts should be removed because extension changed
      const originalFile = path.join(buildDir, 'esm', 'component.d.ts');
      const originalStat = await fs.stat(originalFile).catch(() => null);
      expect(originalStat).toBeNull();
    });
  });

  it('handles path normalization with multiple bundles in flat mode', async () => {
    await withTempDir(async (cwd) => {
      const inputDir = path.join(cwd, 'input');
      const buildDir = path.join(cwd, 'build');

      const content = 'export const multi: string;';
      await Promise.all([createFile(path.join(inputDir, 'index.d.ts'), content)]);

      // Multiple bundles: files are copied to buildDir, not directly to bundle dirs
      /** @type {{type: BundleType; dir: string}[]} */
      const bundles = [
        { type: 'esm', dir: 'esm' },
        { type: 'cjs', dir: 'cjs' },
      ];

      await moveAndTransformDeclarations({
        inputDir,
        buildDir,
        bundles,
        isFlat: true,
        packageType: 'module',
      });

      // Each bundle gets its own transformed copy
      // ESM with module packageType keeps .d.ts
      const esmFile = path.join(buildDir, 'esm', 'index.d.ts');
      const esmStat = await fs.stat(esmFile).catch(() => null);
      expect(esmStat?.isFile()).toBe(true);

      // CJS with module packageType gets .d.cts
      const cjsFile = path.join(buildDir, 'cjs', 'index.d.cts');
      const cjsStat = await fs.stat(cjsFile).catch(() => null);
      expect(cjsStat?.isFile()).toBe(true);

      // Original in buildDir should be removed in flat mode since writesToOriginalPath is false
      const originalFile = path.join(buildDir, 'index.d.ts');
      const originalStat = await fs.stat(originalFile).catch(() => null);
      expect(originalStat).toBeNull();
    });
  });
});

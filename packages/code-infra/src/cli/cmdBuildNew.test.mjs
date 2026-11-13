import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import { expect, it } from 'vitest';

import { makeTempFiles } from '../utils/testUtils.mjs';

const cli = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));

it('compiles each source module to ESM and CJS', async () => {
  const cwd = await makeTempFiles({
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.ts', './math/*': './src/math/*.ts' },
      publishConfig: { directory: 'build' },
    }),
    'pnpm-workspace.yaml': 'packages: []\n',
    'node_modules/external/package.json': JSON.stringify({ name: 'external', main: 'index.js' }),
    'node_modules/external/index.js': 'module.exports = 40;',
    'src/index.ts':
      "import base from 'external';\nexport { two } from './math/two';\nexport const value: number = base;",
    'src/math/two.ts': 'export const two = 2;',
    'src/math/three.ts': 'export default 3;',
    'src/math/two.test.ts': 'throw new Error("test files must not be built");',
    'build/stale.js': 'stale',
  });

  await execa(process.execPath, [cli, 'build-new'], { cwd });

  const outDir = path.join(cwd, 'build');
  const output = await fs.readdir(outDir, { recursive: true });
  expect(output).toEqual(
    expect.arrayContaining(['index.js', 'index.cjs', 'math/two.js', 'math/two.cjs']),
  );
  expect(output.filter((file) => /test|stale|node_modules/.test(file))).toEqual([]);
  expect(await fs.readFile(path.join(outDir, 'index.js'), 'utf8')).toContain('from "external"');

  const esm = await import(pathToFileURL(path.join(outDir, 'index.js')).href);
  const cjs = createRequire(import.meta.url)(path.join(outDir, 'index.cjs'));
  expect({ value: esm.value, two: esm.two }).toEqual({ value: 40, two: 2 });
  expect({ value: cjs.value, two: cjs.two }).toEqual({ value: 40, two: 2 });
  expect(createRequire(import.meta.url)(path.join(outDir, 'math/three.cjs')).default).toBe(3);
});

it.each([
  ['./src/assets/**/*.txt', 'docs/*.md:docs', 'missing.txt'],
  ['src/assets/**/*.txt:public', 'src/assets'],
])('copies the same files as the Babel build for %s', async (...copy) => {
  const root = await makeTempFiles({
    'package.json': JSON.stringify({ private: true }),
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'babel.config.mjs': 'export default {};',
    LICENSE: 'Workspace license',
    'CHANGELOG.md': 'Workspace changes',
    'packages/example/package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      dependencies: {},
      exports: { '.': './src/index.js' },
      publishConfig: { directory: 'build' },
    }),
    'packages/example/README.md': 'Package README',
    'packages/example/docs/guide.md': 'Guide',
    'packages/example/src/index.js': 'export const value = 42;',
    'packages/example/src/assets/example.txt': 'Asset',
    'packages/example/src/assets/nested/example.txt': 'Nested asset',
  });
  const cwd = path.join(root, 'packages/example');
  const outDir = path.join(cwd, 'build');
  const readCopied = async () => {
    const output = await fs.readdir(outDir, { recursive: true, withFileTypes: true });
    const copied = output
      .filter((entry) => entry.isFile() && !/\.(c?js|json)$/.test(entry.name))
      .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)));
    const contents = await Promise.all(
      copied.map(async (file) => [file, await fs.readFile(path.join(outDir, file), 'utf8')]),
    );
    return Object.fromEntries(contents);
  };

  await execa(
    process.execPath,
    [
      cli,
      'build',
      '--bundle',
      'esm',
      '--no-buildTypes',
      '--skipBabelRuntimeCheck',
      '--skipPublint',
      '--copy',
      ...copy,
    ],
    { cwd },
  );
  const legacy = await readCopied();

  await execa(process.execPath, [cli, 'build-new', '--copy', ...copy], { cwd });

  expect(legacy).toHaveProperty('README.md', 'Package README');
  expect(await readCopied()).toEqual(legacy);
});

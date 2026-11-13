import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import { expect, it } from 'vitest';

import { makeTempFiles } from '../utils/testUtils.mjs';

const cli = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));
const BROWSERSLIST = '[stable]\nchrome 100\n[node]\nnode 14.0\n';

it('compiles each source module to ESM and CJS', async () => {
  const cwd = await makeTempFiles({
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.ts', './math/*': './src/math/*.ts' },
      publishConfig: { directory: 'build' },
    }),
    '.browserslistrc': BROWSERSLIST,
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
    '.browserslistrc': BROWSERSLIST,
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

it('writes the same package.json as the Babel build', async () => {
  const root = await makeTempFiles({
    'package.json': JSON.stringify({ private: true }),
    '.browserslistrc': BROWSERSLIST,
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'babel.config.mjs': 'export default {};',
    'packages/example/package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'code-infra build' },
      dependencies: {},
      devDependencies: { vitest: '*' },
      exports: {
        '.': './src/index.js',
        './math/*': './src/math/*.js',
        './package.json': './package.json',
      },
      imports: { '#cli': './src/cli.js' },
      bin: { example: './src/cli.js' },
      publishConfig: { access: 'public', directory: 'build' },
    }),
    'packages/example/src/index.js': "export { two } from './math/two.js';",
    'packages/example/src/math/two.js': 'export const two = 2;',
    'packages/example/src/cli.js': "import { two } from './math/two.js';\nconsole.log(two);",
  });
  const cwd = path.join(root, 'packages/example');
  const manifest = path.join(cwd, 'build/package.json');
  const bundle = ['--bundle', 'esm', 'cjs'];

  const missing = /was not found in the build output/g;
  const legacyRun = await execa(
    process.execPath,
    [cli, 'build', ...bundle, '--no-buildTypes', '--skipBabelRuntimeCheck', '--skipPublint'],
    { cwd, all: true },
  );
  const legacy = await fs.readFile(manifest, 'utf8');
  await fs.rm(path.dirname(manifest), { recursive: true });

  const run = await execa(process.execPath, [cli, 'build-new', ...bundle], { cwd, all: true });

  expect(run.all.match(missing)).toEqual(legacyRun.all.match(missing));

  expect(JSON.parse(legacy)).toHaveProperty('bin', { example: './cli.js' });
  expect(await fs.readFile(manifest, 'utf8')).toBe(legacy);
});

it('applies the MUI Babel plugins and native transforms', async () => {
  const cwd = await makeTempFiles({
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.2.3',
      type: 'module',
      dependencies: { clsx: '*', 'prop-types': '*' },
      exports: { '.': './src/index.tsx', './context': './src/context.ts' },
      publishConfig: { directory: 'build' },
    }),
    'pnpm-workspace.yaml': 'packages: []\n',
    '.browserslistrc': BROWSERSLIST,
    'src/context.ts':
      "import * as React from 'react';\nexport const Context = React.createContext(null);",
    'src/index.tsx': [
      "import * as React from 'react';",
      "import PropTypes from 'prop-types';",
      "import clsx from 'clsx';",
      'const Button = React.forwardRef<HTMLButtonElement, { className?: string }>((props, ref) => (',
      "  <button ref={ref} className={clsx('root', props.className)} />",
      '));',
      'export function Link(props: { href?: string }) {',
      '  return <a href={props.href} />;',
      '}',
      'Link.propTypes = { href: PropTypes.string };',
      'export const version = process.env.MUI_VERSION;',
      'export const prerelease = process.env.MUI_PRERELEASE;',
      'export const helper = (value?: { a: number }) => value?.a;',
      'export default Button;',
    ].join('\n'),
  });

  await execa(process.execPath, [cli, 'build-new'], { cwd });

  /** @param {string} file */
  const read = (file) => fs.readFile(path.join(cwd, 'build', file), 'utf8');
  const [esm, cjs, context] = await Promise.all([
    read('index.js'),
    read('index.cjs'),
    read('context.js'),
  ]);
  expect(context).toMatch(/\/\*\s*[#@]__PURE__\s*\*\/ React\.createContext/);
  expect(esm).toMatch(/Button\.displayName = "Button"/);
  expect(esm).toContain('process.env.NODE_ENV !== "production" && (Link.propTypes');
  expect(esm).toContain('const version = "1.2.3"');
  expect(esm).toContain('const prerelease = null');
  expect(esm).toContain('from "react/jsx-runtime"');
  expect(esm).toContain('value?.a');
  expect(cjs).not.toContain('?.');
});

it.each([
  ['[stable]\nop_mob 80\n[node]\nnode 14.0\n', /opera_mobile.*"stable"/],
  ['[stable]\nie 11\n[node]\nnode 14.0\n', /ie.*"stable"/],
  ['[stable]\nchrome 100\n', /No browserslist targets.*"node"/],
])('rejects browserslist targets Oxc cannot honour: %j', async (browserslist, message) => {
  const cwd = await makeTempFiles({
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.js' },
      publishConfig: { directory: 'build' },
    }),
    'pnpm-workspace.yaml': 'packages: []\n',
    '.browserslistrc': browserslist,
    'src/index.js': 'export const value = 1;',
  });

  await expect(execa(process.execPath, [cli, 'build-new'], { cwd })).rejects.toThrow(message);
});

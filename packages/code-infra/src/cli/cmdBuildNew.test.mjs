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
      exports: {
        '.': './src/index.ts',
        './math/*': './src/math/*.ts',
        './element': './src/math/element.js',
      },
      publishConfig: { directory: 'build' },
    }),
    '.browserslistrc': BROWSERSLIST,
    'pnpm-workspace.yaml': 'packages: []\n',
    'node_modules/external/package.json': JSON.stringify({ name: 'external', main: 'index.js' }),
    'node_modules/external/index.js': 'module.exports = 40;',
    'src/index.ts':
      "import base from 'external';\nexport { two } from './math/two';\nexport const value: number = base;",
    'src/math/two.ts': 'export const two = 2;',
    'src/math/element.js': 'export const element = <div />;',
    'src/math/three.ts': 'export default 3;',
    'src/math/two.test.ts': 'throw new Error("test files must not be built");',
    'build/stale.js': 'stale',
  });

  await execa(process.execPath, [cli, 'build-new', '--no-buildTypes'], { cwd });

  const outDir = path.join(cwd, 'build');
  const output = await fs.readdir(outDir, { recursive: true });
  expect(output).toEqual(
    expect.arrayContaining([
      'index.js',
      'index.cjs',
      'math/two.js',
      'math/two.cjs',
      'math/element.js',
    ]),
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

  await execa(process.execPath, [cli, 'build-new', '--no-buildTypes', '--copy', ...copy], { cwd });

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

  const run = await execa(
    process.execPath,
    [cli, 'build-new', '--no-buildTypes', '--skipPublint', ...bundle],
    {
      cwd,
      all: true,
    },
  );

  expect(run.all.match(missing)).toEqual(legacyRun.all.match(missing));

  expect(JSON.parse(legacy)).toHaveProperty('bin', { example: './cli.js' });
  expect(await fs.readFile(manifest, 'utf8')).toBe(legacy);
});

it('ignores the same sources as the Babel build', async () => {
  const root = await makeTempFiles({
    'package.json': JSON.stringify({ private: true }),
    '.browserslistrc': BROWSERSLIST,
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'babel.config.mjs': 'export default {};',
    'packages/example/package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      dependencies: {},
      exports: { './*': './src/*.js' },
      publishConfig: { directory: 'build' },
    }),
    'packages/example/src/one.js': 'export const one = 1;',
    'packages/example/src/one.bench.js': 'export const bench = 1;',
  });
  const cwd = path.join(root, 'packages/example');
  const outDir = path.join(cwd, 'build');
  const args = ['--bundle', 'esm', '--no-buildTypes', '--skipPublint', '--ignore', '**/*.bench.js'];

  await execa(process.execPath, [cli, 'build', ...args, '--skipBabelRuntimeCheck'], { cwd });
  const legacy = await fs.readFile(path.join(outDir, 'package.json'), 'utf8');
  await fs.rm(outDir, { recursive: true });

  await execa(process.execPath, [cli, 'build-new', ...args], { cwd });

  expect(await fs.readdir(outDir)).not.toContain('one.bench.js');
  expect(await fs.readFile(path.join(outDir, 'package.json'), 'utf8')).toBe(legacy);
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

  await execa(process.execPath, [cli, 'build-new', '--no-buildTypes'], { cwd });

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

  await expect(
    execa(process.execPath, [cli, 'build-new', '--no-buildTypes'], { cwd }),
  ).rejects.toThrow(message);
});

it('lints the output with publint unless skipped', async () => {
  const cwd = await makeTempFiles({
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      browser: './missing.js',
      exports: { '.': './src/index.js' },
      publishConfig: { directory: 'build' },
    }),
    'pnpm-workspace.yaml': 'packages: []\n',
    '.browserslistrc': BROWSERSLIST,
    'src/index.js': 'export const value = 1;',
  });
  const args = [cli, 'build-new', '--no-buildTypes'];

  await expect(execa(process.execPath, args, { cwd })).rejects.toThrow(/publint found 1 error/);
  await expect(execa(process.execPath, [...args, '--skipPublint'], { cwd })).resolves.toBeDefined();
});

it('applies the workspace Babel config on top of the base config', async () => {
  const baseConfig = fileURLToPath(new URL('../babel-config.mjs', import.meta.url));
  const root = await makeTempFiles({
    'package.json': JSON.stringify({ private: true }),
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    '.browserslistrc': BROWSERSLIST,
    'babel.config.mjs': [
      `import getBaseConfig from ${JSON.stringify(baseConfig)};`,
      'export default function getBabelConfig(api) {',
      '  const config = getBaseConfig(api);',
      "  const plugins = config.plugins.filter(([, , name]) => name !== '@mui/internal-babel-plugin-display-name');",
      "  if (process.env.NODE_ENV === 'production' && process.env.BABEL_ENV) {",
      '    plugins.push(({ types: t }) => ({',
      '      visitor: {',
      '        Identifier(path) {',
      "          if (path.node.name === '__RELEASE__' && path.isReferencedIdentifier()) {",
      "            path.replaceWith(t.stringLiteral('released'));",
      '          }',
      '        },',
      '      },',
      '    }));',
      '  }',
      '  return { ...config, plugins };',
      '}',
    ].join('\n'),
    'packages/example/package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.tsx' },
      publishConfig: { directory: 'build' },
    }),
    'packages/example/src/index.tsx': [
      "import * as React from 'react';",
      'declare const __RELEASE__: string;',
      'export const release = __RELEASE__;',
      'export const Button = React.forwardRef<HTMLButtonElement>((props, ref) => <button ref={ref} />);',
    ].join('\n'),
  });
  const cwd = path.join(root, 'packages/example');

  await execa(process.execPath, [cli, 'build-new', '--no-buildTypes', '--bundle', 'esm'], { cwd });

  const esm = await fs.readFile(path.join(cwd, 'build/index.js'), 'utf8');
  expect(esm).toContain('const release = "released"');
  expect(esm).not.toContain('displayName');
  expect(esm).toMatch(/\/\*\s*[#@]__PURE__\s*\*\/ React\.forwardRef/);
  expect(esm).toContain('/* @__PURE__ */ jsx("button"');
});

it('writes declarations matching the Babel build', async () => {
  const tsc = fileURLToPath(new URL('../../../../node_modules/.bin/tsc', import.meta.url));
  const baseConfig = fileURLToPath(new URL('../babel-config.mjs', import.meta.url));
  const root = await makeTempFiles({
    'package.json': JSON.stringify({ private: true }),
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    '.browserslistrc': BROWSERSLIST,
    'babel.config.mjs': `export { default } from ${JSON.stringify(baseConfig)};`,
    'packages/example/package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      dependencies: {},
      exports: {
        '.': './src/index.ts',
        './answer': './src/answer.ts',
        './nothing': './src/nothing.ts',
        './legacy': './src/legacy.js',
        './Button': './src/Button.js',
      },
      publishConfig: { directory: 'build' },
    }),
    'packages/example/tsconfig.build.json': JSON.stringify({
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        allowJs: true,
        strict: true,
        skipLibCheck: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        rootDir: './src',
        outDir: 'build',
      },
      include: ['src/**/*'],
    }),
    'packages/example/src/index.ts': [
      "import type { ButtonProps } from './Button.js';",
      'export const two: number = 2;',
      "export const props: ButtonProps = { size: 'small' };",
    ].join('\n'),
    'packages/example/src/size.ts': "export type Size = 'small' | 'large';",
    'packages/example/src/answer.ts': 'export default 42;',
    'packages/example/src/nothing.ts': 'export default undefined;',
    'packages/example/src/legacy.js': 'export default function legacy() {\n  return 1;\n}',
    'packages/example/src/legacy.d.ts': [
      'interface LegacyOptions {',
      '  a: number;',
      '}',
      'export default function legacy(options?: LegacyOptions): number;',
      "declare module 'external' {",
      '  interface Augmented {}',
      '}',
    ].join('\n'),
    'packages/example/src/Button.js': 'export default function Button() {\n  return null;\n}',
    'packages/example/src/Button.d.ts': [
      "import type { Size } from './size.js';",
      'interface ButtonState {',
      '  size: Size;',
      '}',
      'export interface ButtonProps {',
      '  size?: ButtonState["size"];',
      '}',
      'declare const Button: (props: ButtonProps) => null;',
      'export default Button;',
    ].join('\n'),
  });
  await fs.mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
  await fs.symlink(tsc, path.join(root, 'node_modules/.bin/tsc'));
  const cwd = path.join(root, 'packages/example');
  const manifest = path.join(cwd, 'build/package.json');

  await execa(
    process.execPath,
    [cli, 'build', '--bundle', 'esm', 'cjs', '--tsgo', '--skipBabelRuntimeCheck', '--skipPublint'],
    { cwd },
  );
  const legacy = await fs.readFile(manifest, 'utf8');
  await fs.rm(path.dirname(manifest), { recursive: true });

  await execa(process.execPath, [cli, 'build-new'], { cwd });

  expect(JSON.parse(legacy).exports['./legacy'].require.types).toBe('./legacy.d.cts');
  expect(await fs.readFile(manifest, 'utf8')).toBe(legacy);
  const read = (/** @type {string} */ file) => fs.readFile(path.join(cwd, 'build', file), 'utf8');
  const exported = (/** @type {string} */ name) =>
    new RegExp(`export (interface ${name}|\\{[^}]*\\b${name}\\b)`);
  for (const ext of ['ts', 'cts']) {
    /* eslint-disable no-await-in-loop */
    const legacyDts = await read(`legacy.d.${ext}`);
    expect(legacyDts).toMatch(exported('LegacyOptions'));
    expect(legacyDts).toMatch(/^declare module 'external'/m);
    expect(await read(`Button.d.${ext}`)).not.toMatch(exported('ButtonState'));
    /* eslint-enable no-await-in-loop */
  }
  expect(await read('index.d.ts')).toContain('from "./Button.js"');
  expect(await read('Button.d.cts')).toContain('from "./size.cjs"');
  expect(await read('answer.d.cts')).not.toContain('export =');
});

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { build as buildPackage } from 'tsdown';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { dtsExportsPlugin } from './dtsExportsPlugin.mjs';
import { getTsgo, makeTempFiles } from './testUtils.mjs';

/**
 * Builds `src/index.d.ts` and returns the output with the code the plugin loaded for each file.
 * @param {Record<string, string>} files
 */
async function build(files) {
  // Rolldown ids are real paths; macOS temp directories sit behind a symlink.
  const cwd = await fs.realpath(await makeTempFiles(files));
  const root = path.join(cwd, 'src');
  /** @type {Map<string, string>} */
  const loaded = new Map();
  const bundle = await rolldown({
    cwd,
    input: path.join(root, 'index.d.ts'),
    plugins: [
      dtsExportsPlugin(root),
      {
        name: 'capture',
        transform(code, id) {
          loaded.set(path.relative(root, id), code);
          return null;
        },
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'es' });
  return { output, loaded };
}

describe('dtsExportsPlugin', () => {
  it('exports the top-level declarations of a module without an export list', async () => {
    const { loaded } = await build({
      'src/index.d.ts': [
        'interface Props {}',
        'declare function render(props: Props): void;',
        'declare global {',
        '  interface Window {}',
        '}',
      ].join('\n'),
    });

    expect(loaded.get('index.d.ts')).toBe(
      [
        'export interface Props {}',
        'export declare function render(props: Props): void;',
        'declare global {',
        '  interface Window {}',
        '}',
      ].join('\n'),
    );
  });

  it('keeps a module with an export list as written', async () => {
    const code = 'interface Props {}\nexport { Props };';
    const { loaded } = await build({ 'src/index.d.ts': code });

    expect(loaded.get('index.d.ts')).toBe(code);
  });

  it('copies imported global declarations with the declarations they reference', async () => {
    const { output } = await build({
      'src/index.d.ts': "import './globals.d.ts';\nexport declare const value: Shared;",
      'src/globals.d.ts': [
        '/// <reference path="./types/nested.d.ts" />',
        'interface Shared {',
        '  value: Nested;',
        '}',
      ].join('\n'),
      'src/types/nested.d.ts': '/// <reference path="../deep.d.ts" />\ninterface Nested {}',
      'src/deep.d.ts': 'type Deep = string;',
    });

    const assets = output.filter((file) => file.type === 'asset').map((file) => file.fileName);
    expect(assets.sort()).toEqual(['deep.d.ts', 'globals.d.ts', 'types/nested.d.ts']);
    expect(output[0].type === 'chunk' && output[0].imports).toEqual(['./globals.d.ts']);
  });
});

it.each(/** @type {const} */ (['cjs', 'es']))(
  'keeps module augmentation through %s re-exports',
  async (format) => {
    const packageType = format === 'es' ? 'module' : 'commonjs';
    const extension = format === 'es' ? '.d.mts' : '.d.ts';

    const cwd = await fs.realpath(
      await makeTempFiles({
        'package.json': JSON.stringify({ type: packageType }),
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            declaration: true,
            emitDeclarationOnly: true,
            module: 'nodenext',
            moduleResolution: 'nodenext',
            rootDir: 'src',
            types: [],
          },
          include: ['src'],
        }),
        'src/index.ts': "export * from './toolbar.js';",
        'src/components.ts': "export * from './toolbar.js';",
        'src/toolbar.ts': 'export interface Props { base?: boolean }',
        'src/slots.ts':
          "import { Props } from './toolbar.js'; export interface Slots { toolbar: Props }",
        'node_modules/pro/package.json': JSON.stringify({
          name: 'pro',
          type: packageType,
          types: 'index.d.ts',
        }),
        'node_modules/pro/index.d.ts':
          "import './augmentation.js'; export * from 'grid/components'; export * from 'grid/slots';",
        'node_modules/pro/augmentation.d.ts':
          "import { Props } from 'grid'; export interface Other extends Props {} declare module 'grid' { interface Marker {} }",
        'node_modules/premium/package.json': JSON.stringify({
          name: 'premium',
          type: packageType,
          types: 'index.d.ts',
        }),
        'node_modules/premium/index.d.ts':
          "import './augmentation.js'; export * from 'grid/components'; export * from 'grid/slots';",
        'node_modules/premium/augmentation.d.ts':
          "import { Slots } from 'pro'; export interface Other { slot: Slots } declare module 'pro' { interface Props { other?: boolean } } declare module 'grid' { interface Props { extra?: boolean } }",
        'consumer.ts':
          "import { Slots, Props } from 'premium'; const direct: Props = { extra: true }; const slot: Slots['toolbar'] = { extra: true };",
      }),
    );

    const tsc = await getTsgo();

    await buildPackage({
      cwd,
      config: false,
      entry: ['src/index.ts', 'src/components.ts', 'src/slots.ts'],
      unbundle: true,
      root: 'src',
      outDir: 'node_modules/grid',
      format,
      tsconfig: 'tsconfig.json',
      dts: { generator: 'tsgo', tsgo: { path: tsc } },
      outExtensions: () => ({ js: format === 'es' ? '.mjs' : '.js' }),
      cjsDefault: false,
      deps: { neverBundle: true },
      inputOptions: { plugins: [dtsExportsPlugin(path.join(cwd, 'src'))] },
      report: false,
      logLevel: 'silent',
    });
    await fs.writeFile(
      path.join(cwd, 'node_modules/grid/package.json'),
      JSON.stringify({
        name: 'grid',
        type: packageType,
        exports: Object.fromEntries(
          ['.', './components', './slots'].map((key) => [
            key,
            { types: `${key === '.' ? './index' : key}${extension}` },
          ]),
        ),
      }),
    );

    const { stdout, stderr } = await promisify(execFile)(
      tsc,
      ['--ignoreConfig', '--noEmit', '--module', 'nodenext', 'consumer.ts'],
      { cwd },
    ).catch((error) => {
      throw new Error(error.stdout, { cause: error });
    });

    expect({ stdout, stderr }).toEqual({ stdout: '', stderr: '' });
  },
);

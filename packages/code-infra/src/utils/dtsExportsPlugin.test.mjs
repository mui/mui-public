import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { build as buildPackage } from 'tsdown';
import { expect, it } from 'vitest';

import { dtsExportsPlugin } from './dtsExportsPlugin.mjs';
import { getTsgo, makeTempFiles } from './testUtils.mjs';

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
      inputOptions: { plugins: [dtsExportsPlugin()] },
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

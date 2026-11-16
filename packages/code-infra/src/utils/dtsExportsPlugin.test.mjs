import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { dtsExportsPlugin } from './dtsExportsPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

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

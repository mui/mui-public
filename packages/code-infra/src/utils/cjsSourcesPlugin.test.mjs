import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { cjsSourcesPlugin } from './cjsSourcesPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

/** @type {Record<'es' | 'cjs', string>} */
const EXTENSIONS = { es: '.mjs', cjs: '.js' };

/**
 * Builds `src/index.js` unbundled to `build` and returns the output directory.
 * @param {Record<string, string>} files
 * @param {'es' | 'cjs'} format
 */
async function build(files, format) {
  // Rolldown reports real paths; macOS temp directories sit behind a symlink.
  const cwd = await fs.realpath(await makeTempFiles(files));
  const sourceDir = path.join(cwd, 'src');
  const bundle = await rolldown({
    cwd,
    input: path.join(sourceDir, 'index.js'),
    platform: 'neutral',
    plugins: [cjsSourcesPlugin(sourceDir, [EXTENSIONS[format]])],
  });
  const outDir = path.join(cwd, 'build');
  await bundle.write({
    dir: outDir,
    format,
    preserveModules: true,
    preserveModulesRoot: sourceDir,
    entryFileNames: `[name]${EXTENSIONS[format]}`,
  });
  return outDir;
}

describe('cjsSourcesPlugin', () => {
  it('emits .cjs sources unchanged and keeps imports of them', async () => {
    const shim = "module.exports = require('./nested/value.cjs');";
    const outDir = await build(
      {
        'src/index.js': "import shim from './shim.cjs';\nexport const value = shim.value;",
        'src/shim.cjs': shim,
        'src/nested/value.cjs': 'module.exports = { value: 1 };',
      },
      'es',
    );

    expect(await fs.readFile(path.join(outDir, 'shim.cjs'), 'utf8')).toBe(shim);
    expect(await fs.readFile(path.join(outDir, 'index.mjs'), 'utf8')).toContain('"./shim.cjs"');
    expect((await import(path.join(outDir, 'index.mjs'))).value).toBe(1);
  });

  it('builds the local modules .cjs sources require', async () => {
    const outDir = await build(
      {
        'src/index.js': "import shim from './shim.cjs';\nexport const value = shim.helper;",
        'src/shim.cjs': "module.exports = require('./helper.js');",
        'src/helper.js': 'export const helper = 2;',
      },
      'cjs',
    );

    expect(createRequire(import.meta.url)(path.join(outDir, 'index.js')).value).toBe(2);
  });

  it('fails when no bundle outputs a required module at its path', async () => {
    await expect(
      build(
        {
          'src/index.js': "import './shim.cjs';",
          'src/shim.cjs': "require('./helper.js');",
          'src/helper.js': 'export const helper = 2;',
        },
        'es',
      ),
    ).rejects.toThrow("shim.cjs requires './helper.js', which no bundle outputs at that path.");
  });
});

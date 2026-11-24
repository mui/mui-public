import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { fileUrlEntriesPlugin } from './fileUrlEntriesPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

/** @type {Record<'es' | 'cjs', string>} */
const EXTENSIONS = { es: 'mjs', cjs: 'cjs' };

/**
 * @param {Record<string, string>} files
 * @param {'es' | 'cjs'} format
 */
async function build(files, format) {
  const cwd = await makeTempFiles(files);
  const bundle = await rolldown({
    cwd,
    input: path.join(cwd, 'src/index.ts'),
    plugins: [fileUrlEntriesPlugin()],
  });
  const outDir = path.join(cwd, 'build');
  await bundle.write({
    dir: outDir,
    format,
    preserveModules: true,
    preserveModulesRoot: path.join(cwd, 'src'),
    entryFileNames: `[name].${EXTENSIONS[format]}`,
  });
  return outDir;
}

const FILES = {
  'src/index.ts': [
    "export const workerUrl = new URL('./workers/worker', import.meta.url);",
    "export const dataUrl = new URL('./data.txt', import.meta.url);",
  ].join('\n'),
  'src/workers/worker.ts': [
    "import { shared } from '../shared';",
    "export const helperUrl = new URL('../helper.ts', import.meta.url);",
    'export const result: string = shared;',
  ].join('\n'),
  'src/helper.ts': 'export const helper = 1;',
  'src/shared.ts': "export const shared = 'shared';",
  'src/data.txt': 'data',
};

describe('fileUrlEntriesPlugin', () => {
  it('builds the script modules new URL references and points the URL at their output', async () => {
    const outDir = await build(FILES, 'es');

    const index = await fs.readFile(path.join(outDir, 'index.mjs'), 'utf8');
    expect(index).toContain('new URL("./workers/worker.mjs", import.meta.url)');
    expect(index).toContain('new URL("./data.txt", import.meta.url)');

    const { workerUrl } = await import(path.join(outDir, 'index.mjs'));
    const worker = await import(workerUrl.href);
    expect(worker.result).toBe('shared');
    expect((await import(worker.helperUrl.href)).helper).toBe(1);
  });

  it('resolves the URL against the CommonJS file', async () => {
    const outDir = await build(FILES, 'cjs');

    const load = createRequire(import.meta.url);
    const { workerUrl } = load(path.join(outDir, 'index.cjs'));
    expect(workerUrl.href).toMatch(/\/build\/workers\/worker\.cjs$/);
    expect(load(fileURLToPath(workerUrl)).result).toBe('shared');
  });
});

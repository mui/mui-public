import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { build } from 'tsdown';
import { describe, expect, it } from 'vitest';

import { dtsNamespacesPlugin } from './dtsNamespacesPlugin.mjs';
import { getTsgo, makeTempFiles } from './testUtils.mjs';

const EXTERNAL = {
  'node_modules/external/package.json': JSON.stringify({ name: 'external', types: 'index.d.ts' }),
  'node_modules/external/index.d.ts': 'export type SeriesId = string;',
};

/**
 * Writes the declarations of `entry` and returns a reader for the output.
 * @param {Record<string, string>} files
 * @param {{ entry?: string; dts?: import('tsdown').UserConfig['dts'] }} [options]
 */
async function buildDts(files, { entry = 'src/index.ts', dts = { oxc: {} } } = {}) {
  // tsgo reports real paths; macOS temp directories sit behind a symlink.
  const cwd = await fs.realpath(await makeTempFiles({ ...EXTERNAL, ...files }));
  await build({
    cwd,
    config: false,
    entry: [entry],
    unbundle: true,
    root: 'src',
    outDir: 'build',
    format: 'es',
    tsconfig: files['tsconfig.json'] ? 'tsconfig.json' : undefined,
    dts,
    deps: { neverBundle: true },
    plugins: [dtsNamespacesPlugin()],
    report: false,
    logLevel: 'silent',
  });
  /** @param {string} file */
  return (file) => fs.readFile(path.join(cwd, 'build', file), 'utf8');
}

describe('dtsNamespacesPlugin', () => {
  it('imports declaration namespaces with import * as', async () => {
    const read = await buildDts({
      'src/index.ts': "export * from './Cell';\nexport * from './models/index';",
      'src/Cell.ts': [
        "import type * as models from './models/index';",
        'export interface Cell {',
        '  id: models.SeriesId;',
        '}',
      ].join('\n'),
      'src/models/index.ts': "export * from 'external';\nexport const local = 1;",
    });

    const [index, cell, models] = await Promise.all(
      ['index.d.mts', 'Cell.d.mts', 'models/index.d.mts'].map(read),
    );
    // The namespace rolldown-plugin-dts declares leaves out `SeriesId`.
    expect(cell).toContain('import * as index_d_exports from "./models/index.mjs";');
    expect(cell).toContain('id: index_d_exports.SeriesId;');
    expect([index, cell, models].join('\n')).not.toMatch(/declare namespace|_exports \}/);
  });

  it('keeps default imports next to a rewritten namespace', async () => {
    // A hand-written index, as in @mui/material.
    const reExports = [
      "export { default as useQuery } from './useQuery/index.js';",
      "export * from './useQuery/index.js';",
      "export * from './props.js';",
    ].join('\n');
    const read = await buildDts(
      {
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            allowJs: true,
            declaration: true,
            emitDeclarationOnly: true,
            module: 'preserve',
            moduleResolution: 'bundler',
            rootDir: 'src',
          },
          include: ['src'],
        }),
        'src/index.js': reExports,
        'src/index.d.ts': reExports,
        'src/useQuery/index.ts': [
          "import type { SeriesId } from 'external';",
          "export type * from 'external';",
          'const useQuery = (id: SeriesId): boolean => id.length > 0;',
          'export default useQuery;',
        ].join('\n'),
        // Reads a name the module only re-exports from a package.
        'src/props.ts': [
          "import type { SeriesId } from './useQuery/index.js';",
          'export interface Props {',
          '  id: SeriesId;',
          '}',
        ].join('\n'),
      },
      { entry: 'src/index.js', dts: { generator: 'tsgo', tsgo: { path: await getTsgo() } } },
    );

    const index = await read('index.d.mts');
    expect(index).toMatch(/import useQuery(, \{[^}]*\})? from "\.\/useQuery\/index\.mjs";/);
    expect(index).not.toMatch(/import \{[^}]*\buseQuery\b/);
  });
});

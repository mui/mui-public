import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { build } from 'tsdown';
import { describe, expect, it } from 'vitest';

import { dtsNamespacesPlugin } from './dtsNamespacesPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

describe('dtsNamespacesPlugin', () => {
  it('imports declaration namespaces with import * as', async () => {
    const cwd = await makeTempFiles({
      'node_modules/external/package.json': JSON.stringify({
        name: 'external',
        types: 'index.d.ts',
      }),
      'node_modules/external/index.d.ts': 'export type SeriesId = string;',
      'src/index.ts': "export * from './Cell';\nexport * from './models/index';",
      'src/Cell.ts': [
        "import type * as models from './models/index';",
        'export interface Cell {',
        '  id: models.SeriesId;',
        '}',
      ].join('\n'),
      'src/models/index.ts': "export * from 'external';\nexport const local = 1;",
    });

    await build({
      cwd,
      config: false,
      entry: ['src/index.ts'],
      unbundle: true,
      root: 'src',
      outDir: 'build',
      format: 'es',
      // Oxc's isolated declarations need no TypeScript install.
      dts: { oxc: {} },
      deps: { neverBundle: true },
      plugins: [dtsNamespacesPlugin()],
      report: false,
      logLevel: 'silent',
    });

    /** @param {string} file */
    const read = (file) => fs.readFile(path.join(cwd, 'build', file), 'utf8');
    const [index, cell, models] = await Promise.all(
      ['index.d.mts', 'Cell.d.mts', 'models/index.d.mts'].map(read),
    );
    // The namespace rolldown-plugin-dts declares leaves out `SeriesId`.
    expect(cell).toContain('import * as index_d_exports from "./models/index.mjs";');
    expect(cell).toContain('id: index_d_exports.SeriesId;');
    expect([index, cell, models].join('\n')).not.toMatch(/declare namespace|_exports \}/);
  });
});

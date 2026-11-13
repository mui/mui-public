import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import { expect, it } from 'vitest';

import { makeTempDir } from '../utils/testUtils.mjs';

const cli = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));

it('compiles each source module to ESM and CJS', async () => {
  const cwd = await makeTempDir();
  const files = {
    'package.json': JSON.stringify({
      name: '@test/example',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.ts' },
      publishConfig: { directory: 'build' },
    }),
    'node_modules/external/package.json': JSON.stringify({ name: 'external', main: 'index.js' }),
    'node_modules/external/index.js': 'module.exports = 40;',
    'src/index.ts':
      "import base from 'external';\nexport { two } from './math/two';\nexport const value: number = base;",
    'src/math/two.ts': 'export const two = 2;',
    'src/math/three.ts': 'export default 3;',
    'src/math/two.test.ts': 'throw new Error("test files must not be built");',
    'build/stale.js': 'stale',
  };
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const file = path.join(cwd, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    }),
  );

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

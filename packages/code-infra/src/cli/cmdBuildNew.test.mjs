import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { expect, it, onTestFinished } from 'vitest';

const cli = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));

it('loads the new build command without building or changing files', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'build-new-noop-'));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ private: true }),
    'tsdown.config.mjs': 'throw new Error("The no-op must not load build configuration");',
    'src/index.js': 'export const value = 1;',
    'build/index.js': 'Existing output',
  };
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const file = path.join(cwd, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    }),
  );
  const before = (await fs.readdir(cwd, { recursive: true })).sort();

  const result = await execa(process.execPath, [cli, 'build-new'], { cwd });

  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
  expect((await fs.readdir(cwd, { recursive: true })).sort()).toEqual(before);
  const contents = await Promise.all(
    Object.keys(files).map(async (name) => [name, await fs.readFile(path.join(cwd, name), 'utf8')]),
  );
  expect(Object.fromEntries(contents)).toEqual(files);
});

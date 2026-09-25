import * as path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils';
import { discoverBenchFiles, writeBenchPages } from './benchFiles';

/** A throwaway harness holding the given files under `src/`. */
async function makeHarness(files: string[]): Promise<string> {
  const harnessDir = await makeTempDir();
  await Promise.all(
    files.map(async (file) => {
      const absolute = path.join(harnessDir, 'src', file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, '');
    }),
  );
  return harnessDir;
}

describe('discoverBenchFiles', () => {
  it('finds benchmark files at any depth, each with its own page', async () => {
    const harnessDir = await makeHarness([
      'button/button.bench.tsx',
      'grid/rows/rows.bench.tsx',
      'button/index.html',
    ]);
    expect(await discoverBenchFiles({ harnessDir })).toEqual([
      { file: 'button/button.bench.tsx', page: '__bench__/button-button.html' },
      { file: 'grid/rows/rows.bench.tsx', page: '__bench__/grid-rows-rows.html' },
    ]);
  });

  it('filters by path, case-insensitively', async () => {
    const harnessDir = await makeHarness(['button/button.bench.tsx', 'grid/grid.bench.tsx']);
    const files = await discoverBenchFiles({ harnessDir, filters: ['GRID'] });
    expect(files.map((benchFile) => benchFile.file)).toEqual(['grid/grid.bench.tsx']);
  });
});

describe('writeBenchPages', () => {
  it('writes a page that loads the benchmark file before reporting ready', async () => {
    const harnessDir = await makeHarness(['button/button.bench.tsx']);
    await writeBenchPages(harnessDir, await discoverBenchFiles({ harnessDir }));

    const pagesDir = path.join(harnessDir, 'src', '__bench__');
    expect((await readdir(pagesDir)).sort()).toEqual([
      '.gitignore',
      'button-button.entry.ts',
      'button-button.html',
    ]);
    expect(await readFile(path.join(pagesDir, 'button-button.entry.ts'), 'utf8'))
      .toMatchInlineSnapshot(`
      "import '../button/button.bench';
      import { markPageReady } from '@mui/internal-benchmark/page';

      void markPageReady();
      "
    `);
  });

  it('drops pages of benchmark files that no longer exist', async () => {
    const harnessDir = await makeHarness(['button/button.bench.tsx']);
    await writeBenchPages(harnessDir, await discoverBenchFiles({ harnessDir }));
    await writeBenchPages(harnessDir, []);

    await expect(readdir(path.join(harnessDir, 'src', '__bench__'))).rejects.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTypescriptConfig } from './loadTypescriptConfig';

async function withFixture(
  files: Record<string, unknown>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'load-typescript-config-')));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const filePath = path.join(dir, relativePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(
          filePath,
          typeof content === 'string' ? content : JSON.stringify(content),
          'utf-8',
        );
      }),
    );
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('loadTypescriptConfig', () => {
  it('loads compiler options from a standalone tsconfig', async () => {
    await withFixture(
      {
        'tsconfig.json': { compilerOptions: { strict: true }, files: ['index.ts'] },
        'index.ts': '',
      },
      async (dir) => {
        const configPath = path.join(dir, 'tsconfig.json');

        const result = await loadTypescriptConfig(configPath);

        expect(result.projectPath).toBe(dir);
        expect(result.options.strict).toBe(true);
        expect(result.options.configFilePath).toBe(configPath);
        expect(result.dependencies).toEqual([configPath]);
      },
    );
  });

  it('inherits options from an extended tsconfig and lists it as a dependency', async () => {
    await withFixture(
      {
        'tsconfig.base.json': { compilerOptions: { strict: true, jsx: 'preserve' } },
        'docs/tsconfig.json': {
          extends: '../tsconfig.base.json',
          compilerOptions: { jsx: 'react-jsx' },
          files: ['index.ts'],
        },
        'docs/index.ts': '',
      },
      async (dir) => {
        const configPath = path.join(dir, 'docs/tsconfig.json');

        const result = await loadTypescriptConfig(configPath);

        expect(result.options.strict).toBe(true);
        expect(result.options.jsx).toBe(4 /* ts.JsxEmit.ReactJSX */);
        expect(result.dependencies).toEqual([configPath, path.join(dir, 'tsconfig.base.json')]);
      },
    );
  });

  it('resolves paths against the tsconfig that defines them', async () => {
    await withFixture(
      {
        'tsconfig.base.json': { compilerOptions: { paths: { '@lib/*': ['./lib/*'] } } },
        'docs/tsconfig.json': { extends: '../tsconfig.base.json', files: ['index.ts'] },
        'docs/index.ts': '',
      },
      async (dir) => {
        const result = await loadTypescriptConfig(path.join(dir, 'docs/tsconfig.json'));

        expect(result.options.paths).toEqual({ '@lib/*': ['./lib/*'] });
        expect(result.options.pathsBasePath).toBe(dir);
      },
    );
  });

  it('replaces inherited paths when the tsconfig defines its own, like tsc', async () => {
    await withFixture(
      {
        'tsconfig.base.json': { compilerOptions: { paths: { '@lib/*': ['./lib/*'] } } },
        'docs/tsconfig.json': {
          extends: '../tsconfig.base.json',
          compilerOptions: { paths: { '@docs/*': ['./src/*'] } },
          files: ['index.ts'],
        },
        'docs/index.ts': '',
      },
      async (dir) => {
        const result = await loadTypescriptConfig(path.join(dir, 'docs/tsconfig.json'));

        expect(result.options.paths).toEqual({ '@docs/*': ['./src/*'] });
        expect(result.options.pathsBasePath).toBe(path.join(dir, 'docs'));
      },
    );
  });

  it('supports multiple extended tsconfigs and package specifiers', async () => {
    await withFixture(
      {
        'node_modules/@scope/tsconfig/tsconfig.json': {
          compilerOptions: { strict: true, noEmit: false },
        },
        'tsconfig.local.json': { compilerOptions: { noEmit: true } },
        'tsconfig.json': {
          extends: ['@scope/tsconfig/tsconfig.json', './tsconfig.local.json'],
          files: ['index.ts'],
        },
        'index.ts': '',
      },
      async (dir) => {
        const configPath = path.join(dir, 'tsconfig.json');

        const result = await loadTypescriptConfig(configPath);

        expect(result.options.strict).toBe(true);
        expect(result.options.noEmit).toBe(true);
        expect(result.dependencies).toEqual([
          configPath,
          path.join(dir, 'node_modules/@scope/tsconfig/tsconfig.json'),
          path.join(dir, 'tsconfig.local.json'),
        ]);
      },
    );
  });

  it('rejects a tsconfig with invalid JSON', async () => {
    await withFixture({ 'tsconfig.json': '{ "compilerOptions": { , } }' }, async (dir) => {
      await expect(loadTypescriptConfig(path.join(dir, 'tsconfig.json'))).rejects.toMatchObject({
        messageText: expect.any(String),
      });
    });
  });

  it('rejects a tsconfig that extends a missing file', async () => {
    await withFixture(
      {
        'tsconfig.json': { extends: './missing.json', files: ['index.ts'] },
        'index.ts': '',
      },
      async (dir) => {
        await expect(loadTypescriptConfig(path.join(dir, 'tsconfig.json'))).rejects.toMatchObject({
          messageText: expect.stringContaining('missing.json'),
        });
      },
    );
  });
});

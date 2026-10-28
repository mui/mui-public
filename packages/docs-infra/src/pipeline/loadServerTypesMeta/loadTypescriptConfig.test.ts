import { describe, it, expect, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { loadTypescriptConfig } from './loadTypescriptConfig';

/**
 * Writes `files` into a fresh temp directory that is removed when the test finishes.
 * Object contents are serialized as JSON.
 */
async function createFixture(files: Record<string, unknown>): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'load-typescript-config-')));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
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
  return dir;
}

describe('loadTypescriptConfig', () => {
  it('loads compiler options from a standalone tsconfig', async () => {
    const dir = await createFixture({
      'tsconfig.json': { compilerOptions: { strict: true }, files: ['index.ts'] },
      'index.ts': '',
    });
    const configPath = path.join(dir, 'tsconfig.json');

    const result = await loadTypescriptConfig(configPath);

    expect(result.projectPath).toBe(dir);
    expect(result.options.strict).toBe(true);
    expect(path.normalize(result.options.configFilePath as string)).toBe(configPath);
    expect(result.dependencies).toEqual([configPath]);
  });

  it('inherits options from an extended tsconfig and lists it as a dependency', async () => {
    const dir = await createFixture({
      'tsconfig.base.json': { compilerOptions: { strict: true, jsx: 'preserve' } },
      'docs/tsconfig.json': {
        extends: '../tsconfig.base.json',
        compilerOptions: { jsx: 'react-jsx' },
        files: ['index.ts'],
      },
      'docs/index.ts': '',
    });
    const configPath = path.join(dir, 'docs/tsconfig.json');

    const result = await loadTypescriptConfig(configPath);

    expect(result.options.strict).toBe(true);
    expect(result.options.jsx).toBe(ts.JsxEmit.ReactJSX);
    expect(result.dependencies).toEqual([configPath, path.join(dir, 'tsconfig.base.json')]);
  });

  it('resolves paths against the tsconfig that defines them', async () => {
    const dir = await createFixture({
      'tsconfig.base.json': { compilerOptions: { paths: { '@lib/*': ['./lib/*'] } } },
      'docs/tsconfig.json': { extends: '../tsconfig.base.json', files: ['index.ts'] },
      'docs/index.ts': '',
    });

    const result = await loadTypescriptConfig(path.join(dir, 'docs/tsconfig.json'));

    expect(result.options.paths).toEqual({ '@lib/*': ['./lib/*'] });
    expect(path.normalize(result.options.pathsBasePath as string)).toBe(dir);
  });

  it('replaces inherited paths when the tsconfig defines its own, like tsc', async () => {
    const dir = await createFixture({
      'tsconfig.base.json': { compilerOptions: { paths: { '@lib/*': ['./lib/*'] } } },
      'docs/tsconfig.json': {
        extends: '../tsconfig.base.json',
        compilerOptions: { paths: { '@docs/*': ['./src/*'] } },
        files: ['index.ts'],
      },
      'docs/index.ts': '',
    });

    const result = await loadTypescriptConfig(path.join(dir, 'docs/tsconfig.json'));

    expect(result.options.paths).toEqual({ '@docs/*': ['./src/*'] });
    expect(path.normalize(result.options.pathsBasePath as string)).toBe(path.join(dir, 'docs'));
  });

  it('supports multiple extended tsconfigs and package specifiers', async () => {
    const dir = await createFixture({
      'node_modules/@scope/tsconfig/tsconfig.json': {
        compilerOptions: { strict: true, noEmit: false },
      },
      'tsconfig.local.json': { compilerOptions: { noEmit: true } },
      'tsconfig.json': {
        extends: ['@scope/tsconfig/tsconfig.json', './tsconfig.local.json'],
        files: ['index.ts'],
      },
      'index.ts': '',
    });
    const configPath = path.join(dir, 'tsconfig.json');

    const result = await loadTypescriptConfig(configPath);

    expect(result.options.strict).toBe(true);
    expect(result.options.noEmit).toBe(true);
    expect(result.dependencies).toEqual([
      configPath,
      path.join(dir, 'node_modules/@scope/tsconfig/tsconfig.json'),
      path.join(dir, 'tsconfig.local.json'),
    ]);
  });

  it('rejects a tsconfig with invalid JSON', async () => {
    const dir = await createFixture({
      'tsconfig.json': '{ "compilerOptions": { , }, "files": ["index.ts"] }',
      'index.ts': '',
    });

    await expect(loadTypescriptConfig(path.join(dir, 'tsconfig.json'))).rejects.toThrow(
      'error TS1136: Property assignment expected.',
    );
  });

  it('rejects a tsconfig that extends a missing file', async () => {
    const dir = await createFixture({
      'tsconfig.json': { extends: './missing.json', files: ['index.ts'] },
      'index.ts': '',
    });

    await expect(loadTypescriptConfig(path.join(dir, 'tsconfig.json'))).rejects.toThrow(
      /error TS5083: Cannot read file '.*missing\.json'/,
    );
  });

  it('rejects a missing tsconfig', async () => {
    const dir = await createFixture({});

    await expect(loadTypescriptConfig(path.join(dir, 'tsconfig.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('loads a tsconfig again after a failed load', async () => {
    const dir = await createFixture({
      'tsconfig.base.json': { compilerOptions: { target: 'invalid' } },
      'tsconfig.json': { extends: './tsconfig.base.json', files: ['index.ts'] },
      'index.ts': '',
    });
    const configPath = path.join(dir, 'tsconfig.json');
    await expect(loadTypescriptConfig(configPath)).rejects.toThrow('--target');

    await writeFile(
      path.join(dir, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { target: 'es2020' } }),
    );
    const result = await loadTypescriptConfig(configPath);

    expect(result.options.target).toBe(ts.ScriptTarget.ES2020);
  });
});

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { writeOverrides } from './cmdSetVersionOverrides.mjs';

/**
 * @param {string} filePath
 * @param {string} contents
 */
async function seedFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

/**
 * @param {string} cwd
 * @param {string} name
 */
function read(cwd, name) {
  return fs.readFile(path.join(cwd, name), 'utf8');
}

describe('writeOverrides', () => {
  it('pins into an existing pnpm-workspace.yaml, preserving comments', async () => {
    const cwd = await makeTempDir();
    const packageJson = `${JSON.stringify({ name: 'root', private: true }, null, 2)}\n`;
    await seedFile(path.join(cwd, 'package.json'), packageJson);
    await seedFile(
      path.join(cwd, 'pnpm-workspace.yaml'),
      [
        'packages:',
        "  - 'packages/*'",
        'overrides:',
        '  # keep this pin',
        "  bar: '2.0.0'",
        '',
      ].join('\n'),
    );

    await writeOverrides(cwd, { '@scope/pkg': '1.49.1', foo: '1.49.1' });

    expect(await read(cwd, 'pnpm-workspace.yaml')).toMatchInlineSnapshot(`
      "packages:
        - 'packages/*'
      overrides:
        # keep this pin
        bar: '2.0.0'
        "@scope/pkg": 1.49.1
        foo: 1.49.1
      "
    `);
    // package.json is left untouched.
    expect(await read(cwd, 'package.json')).toBe(packageJson);
  });

  it('creates pnpm-workspace.yaml when it does not exist', async () => {
    const cwd = await makeTempDir();
    await seedFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root', private: true }, null, 2)}\n`,
    );

    await writeOverrides(cwd, { foo: '1.2.3' });

    expect(await read(cwd, 'pnpm-workspace.yaml')).toMatchInlineSnapshot(`
      "overrides:
        foo: 1.2.3
      "
    `);
  });

  it('overwrites a same-named override, keeping its quote style', async () => {
    const cwd = await makeTempDir();
    await seedFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root', private: true }, null, 2)}\n`,
    );
    await seedFile(
      path.join(cwd, 'pnpm-workspace.yaml'),
      ['overrides:', "  foo: '1.0.0'", ''].join('\n'),
    );

    await writeOverrides(cwd, { foo: '2.0.0' });

    expect(await read(cwd, 'pnpm-workspace.yaml')).toMatchInlineSnapshot(`
      "overrides:
        foo: '2.0.0'
      "
    `);
  });

  it('writes to package.json when only it defines overrides', async () => {
    const cwd = await makeTempDir();
    await seedFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify(
        {
          name: 'root',
          private: true,
          pnpm: { overrides: { foo: '1.0.0' }, packageExtensions: { thing: {} } },
        },
        null,
        2,
      )}\n`,
    );

    await writeOverrides(cwd, { foo: '2.0.0', bar: '3.0.0' });

    // Pin merged into pnpm.overrides (computed wins), packageExtensions intact.
    expect(JSON.parse(await read(cwd, 'package.json'))).toEqual({
      name: 'root',
      private: true,
      pnpm: {
        overrides: { foo: '2.0.0', bar: '3.0.0' },
        packageExtensions: { thing: {} },
      },
    });
    // No pnpm-workspace.yaml was created.
    await expect(read(cwd, 'pnpm-workspace.yaml')).rejects.toThrow();
  });

  it('prefers the workspace file when both manifests define overrides', async () => {
    const cwd = await makeTempDir();
    const packageJson = `${JSON.stringify(
      { name: 'root', private: true, pnpm: { overrides: { baz: '3.0.0' } } },
      null,
      2,
    )}\n`;
    await seedFile(path.join(cwd, 'package.json'), packageJson);
    await seedFile(
      path.join(cwd, 'pnpm-workspace.yaml'),
      ['overrides:', "  bar: '2.0.0'", ''].join('\n'),
    );

    await writeOverrides(cwd, { foo: '1.2.3' });

    expect(await read(cwd, 'pnpm-workspace.yaml')).toContain('foo: 1.2.3');
    // package.json overrides are left where they were.
    expect(await read(cwd, 'package.json')).toBe(packageJson);
  });

  it('rejects a resolutions field without touching any file', async () => {
    const cwd = await makeTempDir();
    const packageJson = `${JSON.stringify(
      { name: 'root', private: true, resolutions: { foo: '1.0.0' } },
      null,
      2,
    )}\n`;
    await seedFile(path.join(cwd, 'package.json'), packageJson);

    await expect(writeOverrides(cwd, { bar: '2.0.0' })).rejects.toThrow(/resolutions/);

    // Nothing was written.
    expect(await read(cwd, 'package.json')).toBe(packageJson);
    await expect(read(cwd, 'pnpm-workspace.yaml')).rejects.toThrow();
  });

  it('writes every key of a multi-package (React-like) override set', async () => {
    const cwd = await makeTempDir();
    await seedFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root', private: true }, null, 2)}\n`,
    );

    await writeOverrides(cwd, {
      react: '18.3.1',
      'react-dom': '18.3.1',
      'react-is': '18.3.1',
      scheduler: '0.23.0',
    });

    const yaml = await read(cwd, 'pnpm-workspace.yaml');
    expect(yaml).toContain('react: 18.3.1');
    expect(yaml).toContain('react-dom: 18.3.1');
    expect(yaml).toContain('react-is: 18.3.1');
    expect(yaml).toContain('scheduler: 0.23.0');
  });
});

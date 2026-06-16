import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { setOverrides, writeOverridesToWorkspace } from './cmdSetVersionOverrides.mjs';

/**
 * Write a file to a temp directory, creating parent directories as needed.
 * @param {string} filePath - Absolute path to the file
 * @param {string} contents - File contents
 * @returns {Promise<void>}
 */
async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

describe('setOverrides', () => {
  describe('writing to pnpm-workspace.yaml', () => {
    it('creates an overrides block in an empty file', () => {
      const result = setOverrides({}, '', { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "overrides:
          foo: 1.2.3
        "
      `);
    });

    it('merges into an existing overrides block while preserving comments', () => {
      const yamlSource = [
        'packages:',
        "  - 'packages/*'",
        'overrides:',
        '  # keep this pin',
        "  bar: '2.0.0'",
        '',
      ].join('\n');

      const result = setOverrides({}, yamlSource, { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "packages:
          - 'packages/*'
        overrides:
          # keep this pin
          bar: '2.0.0'
          foo: 1.2.3
        "
      `);
    });

    it('quotes scoped package names', () => {
      const result = setOverrides({}, '', { '@scope/pkg': '1.0.0' });

      expect(result.workspaceYaml).toContain('"@scope/pkg": 1.0.0');
    });

    it('overwrites a same-named override rather than duplicating it (keeping its quote style)', () => {
      const yamlSource = ['overrides:', "  foo: '1.0.0'", ''].join('\n');

      const result = setOverrides({}, yamlSource, { foo: '2.0.0' });

      expect(result.workspaceYaml).toMatchInlineSnapshot(`
        "overrides:
          foo: '2.0.0'
        "
      `);
    });

    it('defaults to the workspace file when neither manifest has overrides', () => {
      const result = setOverrides({ pnpm: {} }, '', { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });

    it('prefers the workspace file when both manifests define overrides', () => {
      const yamlSource = ['overrides:', "  bar: '2.0.0'", ''].join('\n');
      const rootPackageJson = { pnpm: { overrides: { baz: '3.0.0' } } };

      const result = setOverrides(rootPackageJson, yamlSource, { foo: '1.2.3' });

      expect(result.packageJson).toBeNull();
      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });
  });

  describe('writing to package.json', () => {
    it('honors the existing package.json location when the workspace file has no overrides', () => {
      const rootPackageJson = {
        name: 'root',
        pnpm: { overrides: { foo: '1.0.0' }, packageExtensions: { thing: {} } },
      };

      const result = setOverrides(rootPackageJson, '', { bar: '2.0.0' });

      expect(result.workspaceYaml).toBeNull();
      expect(result.packageJson).toEqual({
        name: 'root',
        pnpm: {
          overrides: { foo: '1.0.0', bar: '2.0.0' },
          packageExtensions: { thing: {} },
        },
      });
    });

    it('lets computed overrides win over an existing package.json override', () => {
      const rootPackageJson = { pnpm: { overrides: { foo: '1.0.0' } } };

      const result = setOverrides(rootPackageJson, '', { foo: '2.0.0' });

      expect(result.packageJson).toEqual({ pnpm: { overrides: { foo: '2.0.0' } } });
    });
  });

  describe('rejecting resolutions', () => {
    it('throws when package.json has a non-empty resolutions field', () => {
      expect(() => setOverrides({ resolutions: { foo: '1.0.0' } }, '', { bar: '2.0.0' })).toThrow(
        /resolutions/,
      );
    });

    it('ignores an empty resolutions field', () => {
      const result = setOverrides({ resolutions: {} }, '', { foo: '1.2.3' });

      expect(result.workspaceYaml).toContain('foo: 1.2.3');
    });
  });
});

describe('writeOverridesToWorkspace', () => {
  it('adds overrides to an existing pnpm-workspace.yaml, keeping comments and the rest of the file', async () => {
    const cwd = await makeTempDir();
    await Promise.all([
      writeFile(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'root' }, null, 2)}\n`),
      writeFile(
        path.join(cwd, 'pnpm-workspace.yaml'),
        [
          'packages:',
          "  - 'packages/*'",
          'overrides:',
          '  # keep this pin',
          "  bar: '2.0.0'",
          '',
        ].join('\n'),
      ),
    ]);

    await writeOverridesToWorkspace(cwd, { playwright: '1.49.1', '@playwright/test': '1.49.1' });

    const workspaceYaml = await fs.readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceYaml).toMatchInlineSnapshot(`
      "packages:
        - 'packages/*'
      overrides:
        # keep this pin
        bar: '2.0.0'
        playwright: 1.49.1
        "@playwright/test": 1.49.1
      "
    `);

    // The package.json is left untouched.
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    expect(packageJson).toEqual({ name: 'root' });
  });

  it('creates pnpm-workspace.yaml when none exists', async () => {
    const cwd = await makeTempDir();
    await writeFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root' }, null, 2)}\n`,
    );

    await writeOverridesToWorkspace(cwd, { foo: '1.2.3' });

    const workspaceYaml = await fs.readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceYaml).toMatchInlineSnapshot(`
      "overrides:
        foo: 1.2.3
      "
    `);
  });

  it('writes to package.json when overrides already live there and no workspace overrides exist', async () => {
    const cwd = await makeTempDir();
    await writeFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root', pnpm: { overrides: { foo: '1.0.0' } } }, null, 2)}\n`,
    );

    await writeOverridesToWorkspace(cwd, { bar: '2.0.0' });

    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    expect(packageJson).toEqual({
      name: 'root',
      pnpm: { overrides: { foo: '1.0.0', bar: '2.0.0' } },
    });

    // No workspace file is created.
    await expect(fs.access(path.join(cwd, 'pnpm-workspace.yaml'))).rejects.toThrow();
  });

  it('rejects a resolutions field and writes nothing', async () => {
    const cwd = await makeTempDir();
    await writeFile(
      path.join(cwd, 'package.json'),
      `${JSON.stringify({ name: 'root', resolutions: { foo: '1.0.0' } }, null, 2)}\n`,
    );

    await expect(writeOverridesToWorkspace(cwd, { bar: '2.0.0' })).rejects.toThrow(/resolutions/);
    await expect(fs.access(path.join(cwd, 'pnpm-workspace.yaml'))).rejects.toThrow();
  });
});

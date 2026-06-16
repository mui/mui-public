import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { readPackageJson, writePackageJson } from '../utils/pnpm.mjs';
import { writeOverridesToWorkspace } from './cmdSetVersionOverrides.mjs';

/**
 * Set up a temp workspace with a package.json and optional pnpm-workspace.yaml.
 * @param {object} packageJson - package.json contents
 * @param {string} [workspaceYaml] - pnpm-workspace.yaml contents, omitted to skip the file
 * @returns {Promise<string>} The workspace directory
 */
async function makeWorkspace(packageJson, workspaceYaml) {
  const cwd = await makeTempDir();
  const writes = [writePackageJson(cwd, packageJson)];
  if (workspaceYaml !== undefined) {
    writes.push(fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), workspaceYaml));
  }
  await Promise.all(writes);
  return cwd;
}

/**
 * @param {string} cwd
 * @returns {Promise<string>}
 */
function readWorkspaceYaml(cwd) {
  return fs.readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8');
}

describe('writeOverridesToWorkspace', () => {
  describe('writing to pnpm-workspace.yaml', () => {
    it('creates the file with an overrides block when none exists', async () => {
      const cwd = await makeWorkspace({ name: 'root' });

      await writeOverridesToWorkspace(cwd, { foo: '1.2.3' });

      expect(await readWorkspaceYaml(cwd)).toMatchInlineSnapshot(`
        "overrides:
          foo: 1.2.3
        "
      `);
    });

    it('merges into an existing block, preserving comments and quoting scoped names', async () => {
      const cwd = await makeWorkspace(
        { name: 'root' },
        [
          'packages:',
          "  - 'packages/*'",
          'overrides:',
          '  # keep this pin',
          "  bar: '2.0.0'",
          '',
        ].join('\n'),
      );

      await writeOverridesToWorkspace(cwd, { playwright: '1.49.1', '@playwright/test': '1.49.1' });

      expect(await readWorkspaceYaml(cwd)).toMatchInlineSnapshot(`
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
      expect(await readPackageJson(cwd)).toEqual({ name: 'root' });
    });

    it('overwrites a same-named override, keeping its quote style', async () => {
      const cwd = await makeWorkspace(
        { name: 'root' },
        ['overrides:', "  foo: '1.0.0'", ''].join('\n'),
      );

      await writeOverridesToWorkspace(cwd, { foo: '2.0.0' });

      expect(await readWorkspaceYaml(cwd)).toMatchInlineSnapshot(`
        "overrides:
          foo: '2.0.0'
        "
      `);
    });

    it('prefers the workspace file when both manifests define overrides', async () => {
      const cwd = await makeWorkspace(
        { name: 'root', pnpm: { overrides: { baz: '3.0.0' } } },
        ['overrides:', "  bar: '2.0.0'", ''].join('\n'),
      );

      await writeOverridesToWorkspace(cwd, { foo: '1.2.3' });

      expect(await readWorkspaceYaml(cwd)).toContain('foo: 1.2.3');
      // package.json overrides are left where they were.
      expect(await readPackageJson(cwd)).toEqual({
        name: 'root',
        pnpm: { overrides: { baz: '3.0.0' } },
      });
    });
  });

  describe('writing to package.json', () => {
    it('honors the package.json location when no workspace overrides exist', async () => {
      const cwd = await makeWorkspace({
        name: 'root',
        pnpm: { overrides: { foo: '1.0.0' }, packageExtensions: { thing: {} } },
      });

      await writeOverridesToWorkspace(cwd, { bar: '2.0.0' });

      expect(await readPackageJson(cwd)).toEqual({
        name: 'root',
        pnpm: { overrides: { foo: '1.0.0', bar: '2.0.0' }, packageExtensions: { thing: {} } },
      });
      // No workspace file is created.
      await expect(fs.access(path.join(cwd, 'pnpm-workspace.yaml'))).rejects.toThrow();
    });

    it('lets computed overrides win over an existing package.json override', async () => {
      const cwd = await makeWorkspace({ name: 'root', pnpm: { overrides: { foo: '1.0.0' } } });

      await writeOverridesToWorkspace(cwd, { foo: '2.0.0' });

      expect(await readPackageJson(cwd)).toEqual({
        name: 'root',
        pnpm: { overrides: { foo: '2.0.0' } },
      });
    });
  });

  describe('rejecting resolutions', () => {
    it('throws and writes nothing when package.json has a resolutions field', async () => {
      const cwd = await makeWorkspace({ name: 'root', resolutions: { foo: '1.0.0' } });

      await expect(writeOverridesToWorkspace(cwd, { bar: '2.0.0' })).rejects.toThrow(/resolutions/);
      await expect(fs.access(path.join(cwd, 'pnpm-workspace.yaml'))).rejects.toThrow();
    });

    it('ignores an empty resolutions field', async () => {
      const cwd = await makeWorkspace({ name: 'root', resolutions: {} });

      await writeOverridesToWorkspace(cwd, { foo: '1.2.3' });

      expect(await readWorkspaceYaml(cwd)).toContain('foo: 1.2.3');
    });
  });
});

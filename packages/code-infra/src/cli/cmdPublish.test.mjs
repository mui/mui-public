import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import { makeTempDir, writePackage } from '../utils/testUtils.mjs';
import { getReleaseVersion } from './cmdPublish.mjs';

/**
 * Create a workspace root (`pnpm-workspace.yaml` + `package.json`) so
 * `findWorkspaceDir` resolves to it, and return its path.
 * @param {object} rootManifest
 * @returns {Promise<string>}
 */
async function makeWorkspace(rootManifest) {
  const root = await makeTempDir();
  await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(rootManifest, null, 2));
  return root;
}

describe('getReleaseVersion', () => {
  it('reads the version from the workspace-root manifest', async () => {
    const root = await makeWorkspace({ name: 'root', version: '1.2.3' });

    expect(await getReleaseVersion(root)).toBe('1.2.3');
  });

  it('resolves the workspace root when invoked from a package directory', async () => {
    const root = await makeWorkspace({ name: 'root', version: '4.5.6' });
    // A package under the workspace declares its own, unrelated version.
    const pkgDir = await writePackage(root, 'packages/widget', {
      name: '@scope/widget',
      version: '0.0.0',
    });

    // The release version is the root's, not the package the command ran from.
    expect(await getReleaseVersion(pkgDir)).toBe('4.5.6');
  });

  it('normalizes a valid but non-canonical version', async () => {
    const root = await makeWorkspace({ name: 'root', version: 'v2.0.0' });

    expect(await getReleaseVersion(root)).toBe('2.0.0');
  });

  it('returns null when no version is present', async () => {
    const root = await makeWorkspace({ name: 'root' });

    expect(await getReleaseVersion(root)).toBeNull();
  });

  it('returns null for a version that is not valid semver', async () => {
    const root = await makeWorkspace({ name: 'root', version: 'not-a-version' });

    expect(await getReleaseVersion(root)).toBeNull();
  });
});

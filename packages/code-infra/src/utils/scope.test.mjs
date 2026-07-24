import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import { makeTempDir } from './testUtils.mjs';
import { readPackageJson } from './pnpm.mjs';
import { aliasWorkspaceSpec, renameScope, renameWorkspaceScope } from './scope.mjs';

/**
 * @param {string} root
 * @param {string} dir
 * @param {object} pkgJson
 */
async function writePackage(root, dir, pkgJson) {
  const pkgDir = path.join(root, dir);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  return pkgDir;
}

/**
 * @param {string} name
 * @param {string} pkgPath
 * @param {boolean} [isPrivate]
 * @returns {import('./pnpm.mjs').PublicPackage | import('./pnpm.mjs').PrivatePackage}
 */
function pkg(name, pkgPath, isPrivate = false) {
  return /** @type {any} */ ({ name, version: '1.0.0', path: pkgPath, isPrivate });
}

describe('renameScope', () => {
  it('moves a package to another scope', () => {
    expect(renameScope('@base-ui/mosaic', '@base-ui', '@base-ui-private')).toBe(
      '@base-ui-private/mosaic',
    );
  });

  it('returns null when the scope does not match', () => {
    expect(renameScope('@mui/material', '@base-ui', '@base-ui-private')).toBeNull();
    // A scope is a whole path segment — a shared prefix is not a match.
    expect(renameScope('@base-ui-extra/thing', '@base-ui', '@base-ui-private')).toBeNull();
  });
});

describe('aliasWorkspaceSpec', () => {
  it('keeps the range while pointing at the new name', () => {
    expect(aliasWorkspaceSpec('workspace:*', '@base-ui-private/mosaic')).toBe(
      'workspace:@base-ui-private/mosaic@*',
    );
    expect(aliasWorkspaceSpec('workspace:^', '@base-ui-private/mosaic')).toBe(
      'workspace:@base-ui-private/mosaic@^',
    );
  });

  it('leaves non-workspace specs alone', () => {
    expect(aliasWorkspaceSpec('^1.6.0', '@base-ui-private/mosaic')).toBeNull();
  });

  it('leaves an already-aliased spec alone', () => {
    expect(
      aliasWorkspaceSpec('workspace:@base-ui-private/mosaic@*', '@base-ui-private/mosaic'),
    ).toBeNull();
  });
});

describe('renameWorkspaceScope', () => {
  it('renames the package and aliases its dependents without touching imports', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const docs = await writePackage(root, 'docs', {
      name: 'docs',
      version: '1.0.0',
      private: true,
      dependencies: { '@base-ui/mosaic': 'workspace:*' },
    });

    const { renamed } = await renameWorkspaceScope(
      [pkg('@base-ui/mosaic', mosaic), pkg('docs', docs, true)],
      '@base-ui',
      '@base-ui-private',
    );

    expect(Object.fromEntries(renamed)).toEqual({ '@base-ui/mosaic': '@base-ui-private/mosaic' });
    expect((await readPackageJson(mosaic)).name).toBe('@base-ui-private/mosaic');
    // The dependency keeps its original name, so `import '@base-ui/mosaic'` still resolves.
    expect((await readPackageJson(docs)).dependencies).toEqual({
      '@base-ui/mosaic': 'workspace:@base-ui-private/mosaic@*',
    });
  });

  it('never rewrites registry dependencies that share the scope', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const docs = await writePackage(root, 'docs', {
      name: 'docs',
      version: '1.0.0',
      private: true,
      dependencies: {
        '@base-ui/mosaic': 'workspace:*',
        '@base-ui/react': '^1.6.0',
        '@base-ui/utils': '^0.3.1',
      },
    });

    await renameWorkspaceScope(
      [pkg('@base-ui/mosaic', mosaic), pkg('docs', docs, true)],
      '@base-ui',
      '@base-ui-private',
    );

    const deps = (await readPackageJson(docs)).dependencies ?? {};
    expect(deps['@base-ui/react']).toBe('^1.6.0');
    expect(deps['@base-ui/utils']).toBe('^0.3.1');
  });

  it('leaves private workspace packages under the original scope', async () => {
    const root = await makeTempDir();
    const tests = await writePackage(root, 'tests', {
      name: '@base-ui/monorepo-tests',
      version: '1.0.0',
      private: true,
    });

    const { renamed } = await renameWorkspaceScope(
      [pkg('@base-ui/monorepo-tests', tests, true)],
      '@base-ui',
      '@base-ui-private',
    );

    expect(renamed.size).toBe(0);
    expect((await readPackageJson(tests)).name).toBe('@base-ui/monorepo-tests');
  });

  it('leaves dependencies on private same-scope packages untouched', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const tests = await writePackage(root, 'tests', {
      name: '@base-ui/monorepo-tests',
      version: '1.0.0',
      private: true,
    });
    const consumer = await writePackage(root, 'consumer', {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      devDependencies: {
        '@base-ui/mosaic': 'workspace:*',
        '@base-ui/monorepo-tests': 'workspace:*',
      },
    });

    await renameWorkspaceScope(
      [
        pkg('@base-ui/mosaic', mosaic),
        pkg('@base-ui/monorepo-tests', tests, true),
        pkg('consumer', consumer, true),
      ],
      '@base-ui',
      '@base-ui-private',
    );

    const deps = (await readPackageJson(consumer)).devDependencies ?? {};
    expect(deps['@base-ui/mosaic']).toBe('workspace:@base-ui-private/mosaic@*');
    // The private package was never renamed, so pointing at a renamed copy
    // would reference a package that does not exist.
    expect(deps['@base-ui/monorepo-tests']).toBe('workspace:*');
  });

  it('rewrites dependency specs across every dependency field', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const consumer = await writePackage(root, 'consumer', {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      devDependencies: { '@base-ui/mosaic': 'workspace:*' },
      peerDependencies: { '@base-ui/mosaic': 'workspace:^' },
    });

    await renameWorkspaceScope(
      [pkg('@base-ui/mosaic', mosaic), pkg('consumer', consumer, true)],
      '@base-ui',
      '@base-ui-private',
    );

    const manifest = /** @type {any} */ (await readPackageJson(consumer));
    expect(manifest.devDependencies['@base-ui/mosaic']).toBe('workspace:@base-ui-private/mosaic@*');
    expect(manifest.peerDependencies['@base-ui/mosaic']).toBe(
      'workspace:@base-ui-private/mosaic@^',
    );
  });

  it('does nothing when no package matches the scope', async () => {
    const root = await makeTempDir();
    const other = await writePackage(root, 'other', { name: '@mui/material', version: '1.0.0' });

    const { renamed, updatedDependents } = await renameWorkspaceScope(
      [pkg('@mui/material', other)],
      '@base-ui',
      '@base-ui-private',
    );

    expect(renamed.size).toBe(0);
    expect(updatedDependents).toEqual([]);
    expect((await readPackageJson(other)).name).toBe('@mui/material');
  });
});

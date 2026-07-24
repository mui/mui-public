import { describe, it, expect } from 'vitest';

import { makeTempDir, privatePkg, publicPkg, writePackage } from './testUtils.mjs';
import { aliasTarget, readPackageJson } from './pnpm.mjs';
import { aliasWorkspaceSpec, renameScope, renameWorkspaceScope } from './scope.mjs';

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

describe('aliasTarget', () => {
  it('reads the target of a scoped alias', () => {
    expect(aliasTarget('workspace:@base-ui-private/mosaic@*')).toBe('@base-ui-private/mosaic');
  });

  it('reads the target of an unscoped alias', () => {
    expect(aliasTarget('workspace:lodash@*')).toBe('lodash');
  });

  it('returns null for a plain range', () => {
    expect(aliasTarget('workspace:*')).toBeNull();
    expect(aliasTarget('workspace:^1.2.3')).toBeNull();
    expect(aliasTarget('^1.6.0')).toBeNull();
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
    // An unscoped target has no slash to give it away.
    expect(aliasWorkspaceSpec('workspace:lodash@*', '@base-ui-private/mosaic')).toBeNull();
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

    const renamed = await renameWorkspaceScope(
      [publicPkg('@base-ui/mosaic', mosaic), privatePkg('docs', docs)],
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
      [publicPkg('@base-ui/mosaic', mosaic), privatePkg('docs', docs)],
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

    const renamed = await renameWorkspaceScope(
      [privatePkg('@base-ui/monorepo-tests', tests)],
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
        publicPkg('@base-ui/mosaic', mosaic),
        privatePkg('@base-ui/monorepo-tests', tests),
        privatePkg('consumer', consumer),
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

  it('leaves peerDependencies alone, since a consumer supplies them', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const consumer = await writePackage(root, 'consumer', {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      peerDependencies: { '@base-ui/mosaic': 'workspace:^' },
    });

    await renameWorkspaceScope(
      [publicPkg('@base-ui/mosaic', mosaic), privatePkg('consumer', consumer)],
      '@base-ui',
      '@base-ui-private',
    );

    expect((await readPackageJson(consumer)).peerDependencies?.['@base-ui/mosaic']).toBe(
      'workspace:^',
    );
  });

  it('fails on a renamed dependency that is not a workspace: dep', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const consumer = await writePackage(root, 'consumer', {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      dependencies: { '@base-ui/mosaic': '^1.0.0' },
    });

    await expect(
      renameWorkspaceScope(
        [publicPkg('@base-ui/mosaic', mosaic), privatePkg('consumer', consumer)],
        '@base-ui',
        '@base-ui-private',
      ),
    ).rejects.toThrow(/rather than a workspace: dependency/);
  });

  it('recovers from a partial run where the dependent was already aliased', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const docs = await writePackage(root, 'docs', {
      name: 'docs',
      version: '1.0.0',
      private: true,
      dependencies: { '@base-ui/mosaic': 'workspace:@base-ui-private/mosaic@*' },
    });

    await renameWorkspaceScope(
      [publicPkg('@base-ui/mosaic', mosaic), privatePkg('docs', docs)],
      '@base-ui',
      '@base-ui-private',
    );

    expect((await readPackageJson(mosaic)).name).toBe('@base-ui-private/mosaic');
    expect((await readPackageJson(docs)).dependencies?.['@base-ui/mosaic']).toBe(
      'workspace:@base-ui-private/mosaic@*',
    );
  });

  it('fails on a spec already aliased at a package being renamed', async () => {
    const root = await makeTempDir();
    const mosaic = await writePackage(root, 'mosaic', {
      name: '@base-ui/mosaic',
      version: '1.0.0',
    });
    const consumer = await writePackage(root, 'consumer', {
      name: 'consumer',
      version: '1.0.0',
      private: true,
      dependencies: { 'mosaic-alias': 'workspace:@base-ui/mosaic@*' },
    });

    await expect(
      renameWorkspaceScope(
        [publicPkg('@base-ui/mosaic', mosaic), privatePkg('consumer', consumer)],
        '@base-ui',
        '@base-ui-private',
      ),
    ).rejects.toThrow(/already aliases @base-ui\/mosaic/);
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
      optionalDependencies: { '@base-ui/mosaic': 'workspace:^' },
    });

    await renameWorkspaceScope(
      [publicPkg('@base-ui/mosaic', mosaic), privatePkg('consumer', consumer)],
      '@base-ui',
      '@base-ui-private',
    );

    const manifest = await readPackageJson(consumer);
    expect(manifest.devDependencies?.['@base-ui/mosaic']).toBe(
      'workspace:@base-ui-private/mosaic@*',
    );
    expect(manifest.optionalDependencies?.['@base-ui/mosaic']).toBe(
      'workspace:@base-ui-private/mosaic@^',
    );
  });

  it('does nothing when no package matches the scope', async () => {
    const root = await makeTempDir();
    const other = await writePackage(root, 'other', { name: '@mui/material', version: '1.0.0' });

    const renamed = await renameWorkspaceScope(
      [publicPkg('@mui/material', other)],
      '@base-ui',
      '@base-ui-private',
    );

    expect(renamed.size).toBe(0);
    expect((await readPackageJson(other)).name).toBe('@mui/material');
  });
});

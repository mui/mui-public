import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import { makeTempDir, privatePkg, publicPkg, writePackage } from './testUtils.mjs';
import {
  aliasTarget,
  checkPublishDependencies,
  getPackagesNeedingManualPublish,
  getPublishRegistry,
  readPackageJson,
  writePackageJson,
  writeOverridesToWorkspace,
} from './pnpm.mjs';

/**
 * Replace global fetch for the current test. Vitest restores it afterwards
 * (`unstubGlobals`), as it does for `vi.stubEnv` (`unstubEnvs`).
 * @param {(url: URL) => Promise<{status: number, ok: boolean}>} [impl]
 * @returns {import('vitest').Mock} The spy, to assert on calls
 */
function stubFetch(impl = async () => ({ status: 404, ok: false })) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/**
 * Build the workspace maps expected by checkPublishDependencies.
 * @param {(import('./pnpm.mjs').PublicPackage | import('./pnpm.mjs').PrivatePackage)[]} allPkgs
 */
function workspaceMaps(allPkgs) {
  /** @type {Map<string, import('./pnpm.mjs').PublicPackage | import('./pnpm.mjs').PrivatePackage>} */
  const byName = new Map(allPkgs.flatMap((p) => (p.name ? [[p.name, p]] : [])));
  const pathByName = new Map(allPkgs.flatMap((p) => (p.name ? [[p.name, p.path]] : [])));
  return { byName, pathByName };
}

describe('checkPublishDependencies', () => {
  describe('workspace: protocol in dependencies', () => {
    it('returns no issues when all workspace: dependencies are included in the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA, pkgB], byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('reports an issue when a workspace: dependency is missing from the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@scope/pkg-b');
      expect(issues[0]).toContain('Add them to the --filter list');
    });

    it('follows an alias spec to the package it targets, not the dependency key', async () => {
      const root = await makeTempDir();
      // The key `@scope/pkg-b` is no workspace package at all after a rename;
      // only the alias target is. Keying on the dependency name would traverse
      // nothing and silently report a clean publish set.
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:@scope/renamed-b@*' },
      });
      const bDir = await writePackage(root, 'renamed-b', { name: '@scope/renamed-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const renamedB = publicPkg('@scope/renamed-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, renamedB]);

      const missing = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(missing.issues).toHaveLength(1);
      expect(missing.issues[0]).toContain('@scope/renamed-b');

      const complete = await checkPublishDependencies([pkgA, renamedB], byName, pathByName);
      expect(complete.issues).toEqual([]);
    });

    it('reports an issue when a workspace: dependency is private', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b', private: true });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = privatePkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@scope/pkg-b');
      expect(issues[0]).toContain('private');
    });

    it('resolves transitive workspace: dependencies', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', {
        name: '@scope/pkg-b',
        dependencies: { '@scope/pkg-c': 'workspace:*' },
      });
      const cDir = await writePackage(root, 'pkg-c', { name: '@scope/pkg-c' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const pkgC = publicPkg('@scope/pkg-c', cDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB, pkgC]);

      // publishing only A and B — C is missing but transitively required
      const { issues } = await checkPublishDependencies([pkgA, pkgB], byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@scope/pkg-c');

      // publishing all three — no issues
      const { issues: noIssues } = await checkPublishDependencies(
        [pkgA, pkgB, pkgC],
        byName,
        pathByName,
      );
      expect(noIssues).toEqual([]);
    });
  });

  describe('peerDependencies are never hard requirements', () => {
    it('does not require a peer dependency even when using workspace: protocol', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        peerDependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      // publishing only A — B is a workspace: peer dep but must NOT be required
      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('does not require a peer dependency with a pinned version', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        peerDependencies: { '@scope/pkg-b': '^1.0.0' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('does not require a private peer dependency', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        peerDependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b', private: true });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = privatePkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });

  describe('workspace:^ protocol in dependencies', () => {
    it('requires a workspace:^ dependency that is missing from the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:^' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@scope/pkg-b');
    });

    it('returns no issues when a workspace:^ dependency is included in the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:^' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA, pkgB], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });

  describe('devDependencies are never hard requirements', () => {
    it('does not require a workspace: devDependency missing from the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        devDependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('does not require a workspace:^ devDependency missing from the publish set', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        devDependencies: { '@scope/pkg-b': 'workspace:^' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('does not require a private workspace: devDependency', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        devDependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b', private: true });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = privatePkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });

  describe('pinned versions in dependencies are not hard requirements', () => {
    it('does not require a workspace package referenced with a pinned version in dependencies', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': '^1.0.0' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });

  describe('mixed dependency types', () => {
    it('requires workspace: dependencies but not workspace: peers from the same package', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
        peerDependencies: { '@scope/pkg-c': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', { name: '@scope/pkg-b' });
      const cDir = await writePackage(root, 'pkg-c', { name: '@scope/pkg-c' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const pkgC = publicPkg('@scope/pkg-c', cDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB, pkgC]);

      // B is required (workspace: dep), C is not (workspace: peer)
      const { issues } = await checkPublishDependencies([pkgA, pkgB], byName, pathByName);
      expect(issues).toEqual([]);

      // Omitting B should flag it
      const { issues: missingB } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(missingB).toHaveLength(1);
      expect(missingB[0]).toContain('@scope/pkg-b');
    });

    it('does not traverse peer deps when resolving transitive requirements', async () => {
      const root = await makeTempDir();
      // A depends on B (workspace:), B has C as a peer (workspace:)
      // C should NOT be required just because B peers it
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { '@scope/pkg-b': 'workspace:*' },
      });
      const bDir = await writePackage(root, 'pkg-b', {
        name: '@scope/pkg-b',
        peerDependencies: { '@scope/pkg-c': 'workspace:*' },
      });
      const cDir = await writePackage(root, 'pkg-c', { name: '@scope/pkg-c' });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const pkgB = publicPkg('@scope/pkg-b', bDir);
      const pkgC = publicPkg('@scope/pkg-c', cDir);
      const { byName, pathByName } = workspaceMaps([pkgA, pkgB, pkgC]);

      const { issues } = await checkPublishDependencies([pkgA, pkgB], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });

  describe('material-ui packages-internal workspace simulation', () => {
    /**
     * Mirrors the real package structure from material-ui packages-internal/* plus the
     * packages/* that appear as workspace deps.
     *
     * Public packages-internal:
     *   @mui/internal-core-docs   – deps: @mui/internal-markdown (workspace:^)
     *                             – devDeps: @mui-internal/api-docs-builder (workspace:*),
     *                                        @mui/icons-material (workspace:*), @mui/material (workspace:*)
     *                             – peers: @mui/material, @mui/icons-material, @mui/system, … (pinned ranges)
     *   @mui/internal-docs-utils  – no workspace deps
     *   @mui/internal-markdown    – no workspace deps
     *   @mui/internal-scripts     – deps: @mui/internal-docs-utils (workspace:^)
     *
     * Private packages-internal:
     *   @mui-internal/api-docs-builder       – deps: @mui/internal-docs-utils (workspace:^),
     *                                                @mui/internal-markdown (workspace:^)
     *   @mui-internal/api-docs-builder-core  – deps: @mui-internal/api-docs-builder (workspace:^),
     *                                                @mui/internal-markdown (workspace:^)
     *   @mui/internal-waterfall              – no workspace deps
     *
     * Public packages/* (not in the --filter set, resolve from registry):
     *   @mui/material, @mui/icons-material, @mui/system, @mui/utils, @mui/material-nextjs,
     *   @mui/stylis-plugin-rtl, @mui/core-downloads-tracker, @mui/types,
     *   @mui/material-pigment-css, @mui/private-theming, @mui/styled-engine
     */
    /** @param {string} root */
    async function buildMaterialUiWorkspace(root) {
      // packages-internal — public
      const coreDocs = await writePackage(root, 'packages-internal/core-docs', {
        name: '@mui/internal-core-docs',
        version: '9.0.0-beta.1',
        dependencies: {
          '@babel/runtime': '^7.29.2',
          '@mui/internal-markdown': 'workspace:^',
          'clipboard-copy': '^4.0.1',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@mui-internal/api-docs-builder': 'workspace:*',
          '@mui/icons-material': 'workspace:*',
          '@mui/material': 'workspace:*',
        },
        peerDependencies: {
          '@mui/base': '^5.0.0 || ^7.0.0',
          '@mui/icons-material': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          '@mui/material': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          '@mui/material-nextjs': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          '@mui/stylis-plugin-rtl': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          '@mui/system': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          '@mui/utils': '^5.0.0 || ^6.0.0 || ^7.0.0 || ^9.0.0',
          react: '^17.0.0 || ^18.0.0 || ^19.0.0',
        },
      });
      const docsUtils = await writePackage(root, 'packages-internal/docs-utils', {
        name: '@mui/internal-docs-utils',
        version: '3.0.2',
        dependencies: { rimraf: '^6.1.3', typescript: '^5.9.3' },
      });
      const markdown = await writePackage(root, 'packages-internal/markdown', {
        name: '@mui/internal-markdown',
        version: '3.0.6',
        dependencies: { '@babel/runtime': '^7.29.2', marked: '^17.0.5', prismjs: '^1.30.0' },
      });
      const scripts = await writePackage(root, 'packages-internal/scripts', {
        name: '@mui/internal-scripts',
        version: '3.0.5',
        dependencies: {
          '@mui/internal-docs-utils': 'workspace:^',
          '@babel/core': '^7.29.0',
          doctrine: '^3.0.0',
        },
      });

      // packages-internal — private
      const apiDocsBuilder = await writePackage(root, 'packages-internal/api-docs-builder', {
        name: '@mui-internal/api-docs-builder',
        version: '1.0.0',
        private: true,
        dependencies: {
          '@mui/internal-docs-utils': 'workspace:^',
          '@mui/internal-markdown': 'workspace:^',
          '@babel/core': '^7.29.0',
        },
      });
      const apiDocsBuilderCore = await writePackage(
        root,
        'packages-internal/api-docs-builder-core',
        {
          name: '@mui-internal/api-docs-builder-core',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@mui-internal/api-docs-builder': 'workspace:^',
            '@mui/internal-markdown': 'workspace:^',
          },
        },
      );
      const waterfall = await writePackage(root, 'packages-internal/waterfall', {
        name: '@mui/internal-waterfall',
        version: '1.0.0',
        private: true,
      });

      // packages/* — public, resolve from registry (not in the --filter set)
      const material = await writePackage(root, 'packages/material', {
        name: '@mui/material',
        version: '9.0.0-beta.1',
      });
      const iconsM = await writePackage(root, 'packages/icons-material', {
        name: '@mui/icons-material',
        version: '9.0.0-beta.1',
      });
      const muiSystem = await writePackage(root, 'packages/system', {
        name: '@mui/system',
        version: '9.0.0-beta.1',
      });
      const muiUtils = await writePackage(root, 'packages/utils', {
        name: '@mui/utils',
        version: '9.0.0-beta.1',
      });
      const materialNextjs = await writePackage(root, 'packages/material-nextjs', {
        name: '@mui/material-nextjs',
        version: '9.0.0-beta.0',
      });
      const stylisPluginRtl = await writePackage(root, 'packages/stylis-plugin-rtl', {
        name: '@mui/stylis-plugin-rtl',
        version: '9.0.0-beta.0',
      });

      const publicInternalPkgs = [
        publicPkg('@mui/internal-core-docs', coreDocs),
        publicPkg('@mui/internal-docs-utils', docsUtils),
        publicPkg('@mui/internal-markdown', markdown),
        publicPkg('@mui/internal-scripts', scripts),
      ];
      const privateInternalPkgs = [
        privatePkg('@mui-internal/api-docs-builder', apiDocsBuilder),
        privatePkg('@mui-internal/api-docs-builder-core', apiDocsBuilderCore),
        privatePkg('@mui/internal-waterfall', waterfall),
      ];
      const publicMainPkgs = [
        publicPkg('@mui/material', material),
        publicPkg('@mui/icons-material', iconsM),
        publicPkg('@mui/system', muiSystem),
        publicPkg('@mui/utils', muiUtils),
        publicPkg('@mui/material-nextjs', materialNextjs),
        publicPkg('@mui/stylis-plugin-rtl', stylisPluginRtl),
      ];

      const allPkgs = [...publicInternalPkgs, ...privateInternalPkgs, ...publicMainPkgs];
      return { publicInternalPkgs, privateInternalPkgs, publicMainPkgs, allPkgs };
    }

    it('passes with no issues when publishing all public packages-internal packages', async () => {
      const root = await makeTempDir();
      const { publicInternalPkgs, allPkgs } = await buildMaterialUiWorkspace(root);
      const { byName, pathByName } = workspaceMaps(allPkgs);

      const { issues } = await checkPublishDependencies(publicInternalPkgs, byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('passes when @mui/material and other pinned-range peers of core-docs are not in the publish set', async () => {
      const root = await makeTempDir();
      const { publicInternalPkgs, privateInternalPkgs } = await buildMaterialUiWorkspace(root);
      // workspace without the packages/* — simulates --filter "./packages-internal/*"
      const filteredWorkspace = [...publicInternalPkgs, ...privateInternalPkgs];
      const { byName, pathByName } = workspaceMaps(filteredWorkspace);

      const { issues } = await checkPublishDependencies(publicInternalPkgs, byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('passes when workspace:* devDependencies of core-docs are not in the publish set', async () => {
      // core-docs has @mui-internal/api-docs-builder and @mui/icons-material as workspace:*
      // devDependencies. They must NOT be required — devDeps are not installed on consumer devices.
      const root = await makeTempDir();
      const { publicInternalPkgs, allPkgs } = await buildMaterialUiWorkspace(root);
      const { byName, pathByName } = workspaceMaps(allPkgs);

      const { issues } = await checkPublishDependencies(publicInternalPkgs, byName, pathByName);
      expect(issues).toEqual([]);
    });

    it('flags @mui/internal-markdown as missing when core-docs is published without it', async () => {
      const root = await makeTempDir();
      const { publicInternalPkgs, allPkgs } = await buildMaterialUiWorkspace(root);
      const { byName, pathByName } = workspaceMaps(allPkgs);

      const withoutMarkdown = publicInternalPkgs.filter((p) => p.name !== '@mui/internal-markdown');
      const { issues } = await checkPublishDependencies(withoutMarkdown, byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@mui/internal-markdown');
    });

    it('flags @mui/internal-docs-utils as missing when scripts is published without it', async () => {
      const root = await makeTempDir();
      const { publicInternalPkgs, allPkgs } = await buildMaterialUiWorkspace(root);
      const { byName, pathByName } = workspaceMaps(allPkgs);

      const withoutDocsUtils = publicInternalPkgs.filter(
        (p) => p.name !== '@mui/internal-docs-utils',
      );
      const { issues } = await checkPublishDependencies(withoutDocsUtils, byName, pathByName);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('@mui/internal-docs-utils');
    });

    it('flags both missing workspace: deps when core-docs and scripts lack their deps', async () => {
      const root = await makeTempDir();
      const { publicInternalPkgs, allPkgs } = await buildMaterialUiWorkspace(root);
      const { byName, pathByName } = workspaceMaps(allPkgs);

      const onlyCoreDocs = publicInternalPkgs.filter(
        (p) => p.name !== '@mui/internal-markdown' && p.name !== '@mui/internal-docs-utils',
      );
      const { issues } = await checkPublishDependencies(onlyCoreDocs, byName, pathByName);
      expect(issues).toHaveLength(1); // single issue listing both missing packages
      expect(issues[0]).toContain('@mui/internal-markdown');
      expect(issues[0]).toContain('@mui/internal-docs-utils');
    });
  });

  describe('packages not in the workspace', () => {
    it('ignores dependencies that are not workspace packages', async () => {
      const root = await makeTempDir();
      const aDir = await writePackage(root, 'pkg-a', {
        name: '@scope/pkg-a',
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });

      const pkgA = publicPkg('@scope/pkg-a', aDir);
      const { byName, pathByName } = workspaceMaps([pkgA]);

      const { issues } = await checkPublishDependencies([pkgA], byName, pathByName);
      expect(issues).toEqual([]);
    });
  });
});

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

describe('getPublishRegistry', () => {
  it('prefers publishConfig.registry over the ambient registry', async () => {
    const root = await makeTempDir();
    vi.stubEnv('npm_config_registry', 'https://registry.npmjs.org/');
    const pkgDir = await writePackage(root, 'pkg', {
      name: 'my-package',
      version: '1.0.0',
      publishConfig: { registry: 'https://npm.example.com/' },
    });

    expect(await getPublishRegistry(pkgDir)).toBe('https://npm.example.com/');
  });

  it('falls back to the ambient registry', async () => {
    const root = await makeTempDir();
    vi.stubEnv('npm_config_registry', 'https://npm.example.com/');
    const pkgDir = await writePackage(root, 'pkg', { name: 'my-package', version: '1.0.0' });

    expect(await getPublishRegistry(pkgDir)).toBe('https://npm.example.com/');
  });

  it('defaults to the public npm registry', async () => {
    const root = await makeTempDir();
    vi.stubEnv('npm_config_registry', undefined);
    const pkgDir = await writePackage(root, 'pkg', { name: 'my-package', version: '1.0.0' });

    expect(await getPublishRegistry(pkgDir)).toBe('https://registry.npmjs.org/');
  });

  it('collapses repeated trailing slashes to exactly one', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', {
      name: 'my-package',
      version: '1.0.0',
      publishConfig: { registry: 'https://npm.example.com///' },
    });

    expect(await getPublishRegistry(pkgDir)).toBe('https://npm.example.com/');
  });

  it('adds the trailing slash a path-prefixed registry needs', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', {
      name: 'my-package',
      version: '1.0.0',
      publishConfig: { registry: 'https://artifactory.example.com/api/npm/npm-repo' },
    });

    expect(await getPublishRegistry(pkgDir)).toBe(
      'https://artifactory.example.com/api/npm/npm-repo/',
    );
  });

  it('names the package and the value when the registry is unparseable', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', {
      name: 'my-package',
      version: '1.0.0',
      publishConfig: { registry: 'npm.example.com' },
    });

    await expect(getPublishRegistry(pkgDir)).rejects.toThrow(
      /Invalid publish registry "npm\.example\.com" for the package at /,
    );
  });

  it('normalizes host casing and the default port', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', {
      name: 'my-package',
      version: '1.0.0',
      publishConfig: { registry: 'https://REGISTRY.npmjs.org:443' },
    });

    expect(await getPublishRegistry(pkgDir)).toBe('https://registry.npmjs.org/');
  });
});

describe('getPackagesNeedingManualPublish', () => {
  it('returns the packages that do not exist on the registry yet', async () => {
    const root = await makeTempDir();
    vi.stubEnv('npm_config_registry', undefined);
    const newDir = await writePackage(root, 'new', { name: 'new-package', version: '1.0.0' });
    const existingDir = await writePackage(root, 'existing', {
      name: 'existing-package',
      version: '1.0.0',
    });
    stubFetch(async (url) =>
      String(url).endsWith('/new-package') ? { status: 404, ok: false } : { status: 200, ok: true },
    );

    const result = await getPackagesNeedingManualPublish([
      publicPkg('new-package', newDir),
      publicPkg('existing-package', existingDir),
    ]);

    expect(result.map((pkg) => pkg.name)).toEqual(['new-package']);
  });

  it('builds registry URLs without a double slash', async () => {
    const root = await makeTempDir();
    // npm's own default value carries a trailing slash, which used to produce
    // `https://registry.npmjs.org//@scope/name`. npmjs tolerates that, other
    // registries answer 404 and every package looks new.
    vi.stubEnv('npm_config_registry', 'https://registry.npmjs.org/');
    const pkgDir = await writePackage(root, 'pkg', { name: '@scope/name', version: '1.0.0' });
    const fetchSpy = stubFetch(async () => ({ status: 200, ok: true }));

    await getPackagesNeedingManualPublish([publicPkg('@scope/name', pkgDir)]);

    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://registry.npmjs.org/@scope/name');
  });

  it('still recognizes npm when the ambient registry is written differently', async () => {
    const root = await makeTempDir();
    // A non-canonical spelling used to compare unequal to the npm registry, so
    // the bootstrap check silently skipped every package.
    vi.stubEnv('npm_config_registry', 'https://REGISTRY.npmjs.org:443');
    const pkgDir = await writePackage(root, 'pkg', { name: 'my-package', version: '1.0.0' });
    const fetchSpy = stubFetch(async () => ({ status: 404, ok: false }));

    const result = await getPackagesNeedingManualPublish([publicPkg('my-package', pkgDir)]);

    expect(result.map((pkg) => pkg.name)).toEqual(['my-package']);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://registry.npmjs.org/my-package');
  });

  it('skips packages aimed at another registry without any network request', async () => {
    const root = await makeTempDir();
    const pkgDir = await writePackage(root, 'pkg', {
      name: '@scope/private',
      version: '1.0.0',
      publishConfig: { registry: 'https://npm.example.com/' },
    });
    const fetchSpy = stubFetch();

    const result = await getPackagesNeedingManualPublish([publicPkg('@scope/private', pkgDir)]);

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when the registry answers with an unexpected status', async () => {
    const root = await makeTempDir();
    vi.stubEnv('npm_config_registry', undefined);
    const pkgDir = await writePackage(root, 'pkg', { name: 'my-package', version: '1.0.0' });
    stubFetch(async () => ({ status: 401, ok: false }));

    await expect(
      getPackagesNeedingManualPublish([publicPkg('my-package', pkgDir)]),
    ).rejects.toThrow(/my-package.*HTTP 401/);
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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import { makeTempDir } from './testUtils.mjs';
import { checkPublishDependencies } from './pnpm.mjs';

/**
 * Write a package.json file to a temp subdirectory and return the directory path.
 * @param {string} root - Root temp directory
 * @param {string} name - Package subdirectory name
 * @param {object} pkgJson - package.json contents
 * @returns {Promise<string>} Path to the package directory
 */
async function writePackage(root, name, pkgJson) {
  const pkgDir = path.join(root, name);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  return pkgDir;
}

/**
 * @param {string} name
 * @param {string} pkgPath
 * @returns {import('./pnpm.mjs').PublicPackage}
 */
function publicPkg(name, pkgPath) {
  return { name, version: '1.0.0', path: pkgPath, isPrivate: false };
}

/**
 * @param {string} name
 * @param {string} pkgPath
 * @returns {import('./pnpm.mjs').PrivatePackage}
 */
function privatePkg(name, pkgPath) {
  return { name, version: '1.0.0', path: pkgPath, isPrivate: true };
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

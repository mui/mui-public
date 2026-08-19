#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('../utils/pnpm.mjs').PublicPackage} PublicPackage
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
 * @property {'json'|'path'|'name'|'publish-dir'} [output] - Output format (name, path, or json)
 * @property {string} [sinceRef] - Git reference to filter changes since
 * @property {string[]} [filter] - Same as filtering packages with --filter in pnpm. Only include packages matching the filter. See https://pnpm.io/filtering.
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'list-workspaces',
  describe: 'List all pnpm workspaces in the repository',
  builder: (yargs) => {
    return yargs
      .option('public-only', {
        type: 'boolean',
        default: false,
        description: 'Filter to only public packages',
      })
      .option('output', {
        type: 'string',
        choices: ['json', 'path', 'name', 'publish-dir'],
        default: 'path',
        description:
          'Output format: name (package names), path (package paths), publish-dir (publish directories), or json (full JSON)',
      })
      .option('since-ref', {
        type: 'string',
        description: 'Filter packages changed since git reference',
      })
      .option('filter', {
        type: 'string',
        array: true,
        description:
          'Same as filtering packages with --filter in pnpm. Only include packages matching the filter. See https://pnpm.io/filtering.',
      });
  },
  handler: async (argv) => {
    const { publicOnly = false, output = 'name', sinceRef, filter = [] } = argv;

    // Get packages using our helper function
    const packages = await getWorkspacePackages({ sinceRef, publicOnly, filter });

    if (output === 'json') {
      // Serialize packages to JSON
      console.log(JSON.stringify(packages, null, 2));
    } else if (output === 'path') {
      // Print package paths
      packages.forEach((pkg) => {
        console.log(pkg.path);
      });
    } else if (output === 'publish-dir') {
      // Works around https://github.com/stackblitz-labs/pkg.pr.new/issues/389: pkg-pr-new rewrites
      // workspace:* deps to its URLs in the source package.json, but `pnpm pack` honors
      // publishConfig.directory and packs the build package.json, whose workspace:* deps are left to
      // resolve to plain versions. Pointing pkg-pr-new at the build dir makes both act on the same file.
      // Note: #389 was closed by pkg-pr-new#499, but that only fixed the tarball location, not the dep
      // resolution — verified still broken on 0.0.78. Do not remove until the packed deps are URLs
      // without this. Removing it prematurely regressed publishing once (see mui-public#1354).
      // Print publish directories (package.json publishConfig.directory or package path)
      const publishDirs = await Promise.all(
        packages.map(async (pkg) => {
          const packageJsonPath = path.join(pkg.path, 'package.json');
          const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
          const packageJson = JSON.parse(packageJsonContent);

          if (packageJson.publishConfig?.directory) {
            return path.join(pkg.path, packageJson.publishConfig.directory);
          }

          return pkg.path;
        }),
      );

      publishDirs.forEach((dir) => {
        console.log(dir);
      });
    } else if (output === 'name') {
      // Print package names (default)
      packages.forEach((pkg) => {
        console.log(pkg.name);
      });
    } else {
      throw new Error(`Unsupported output format: ${output}`);
    }
  },
});

#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').PublicPackage} PublicPackage
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getWorkspacePackages, isPackagePublished } from './pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
 * @property {boolean} [publishedOnly] - Whether to filter to only published packages
 * @property {'json'|'path'|'name'|'publish-dir'} [output] - Output format (name, path, or json)
 * @property {string} [sinceRef] - Git reference to filter changes since
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
      .option('published-only', {
        type: 'boolean',
        default: false,
        description: 'Filter to only packages published on npm',
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
      });
  },
  handler: async (argv) => {
    const { publicOnly = false, publishedOnly = false, output = 'name', sinceRef } = argv;

    // Get packages using our helper function
    let packages = await getWorkspacePackages({ sinceRef, publicOnly });

    // Filter by published status if requested
    if (publishedOnly) {
      // Check published status in parallel for performance
      const publishedChecks = await Promise.all(
        packages.map(async (pkg) => {
          // Skip packages without names (private packages might not have names)
          if (!pkg.name) {
            return { pkg, isPublished: false };
          }
          const isPublished = await isPackagePublished(pkg.name);
          return { pkg, isPublished };
        }),
      );

      // Filter to only published packages
      packages = publishedChecks.filter(({ isPublished }) => isPublished).map(({ pkg }) => pkg);
    }

    if (output === 'json') {
      // Serialize packages to JSON
      console.log(JSON.stringify(packages, null, 2));
    } else if (output === 'path') {
      // Print package paths
      packages.forEach((pkg) => {
        console.log(pkg.path);
      });
    } else if (output === 'publish-dir') {
      // TODO: Remove this option once https://github.com/stackblitz-labs/pkg.pr.new/issues/389 is resolved
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

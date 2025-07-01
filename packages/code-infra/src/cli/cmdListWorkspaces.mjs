#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').Package} Package
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getWorkspacePackages } from './pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
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
      .option('output', {
        type: 'string',
        choices: ['json', 'path', 'name', 'publish-dir'],
        default: 'name',
        description:
          'Output format: name (package names), path (package paths), publish-dir (publish directories), or json (full JSON)',
      })
      .option('since-ref', {
        type: 'string',
        description: 'Filter packages changed since git reference',
      });
  },
  handler: async (argv) => {
    const { publicOnly = false, output = 'name', sinceRef } = argv;

    try {
      // Get packages using our helper function
      const packages = await getWorkspacePackages({ sinceRef, publicOnly });

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
    } catch (/** @type {any} */ error) {
      console.error('Error listing workspaces:', error.message);
      process.exit(1);
    }
  },
});

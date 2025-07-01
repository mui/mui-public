#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').Package} Package
 */

import { getWorkspacePackages } from './pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
 * @property {'json'|'path'|'name'} [output] - Output format (name, path, or json)
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
        choices: ['json', 'path', 'name'],
        default: 'name',
        description:
          'Output format: name (package names), path (package paths), or json (full JSON)',
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
      } else {
        // Print package names (default)
        packages.forEach((pkg) => {
          console.log(pkg.name);
        });
      }
    } catch (/** @type {any} */ error) {
      console.error('Error listing workspaces:', error.message);
      process.exit(1);
    }
  },
});

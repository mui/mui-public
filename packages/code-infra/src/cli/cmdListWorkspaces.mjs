#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('./pnpm.mjs').Package} Package
 */

import { $ } from 'execa';
import { getWorkspacePackages } from './pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
 * @property {boolean} [json] - Whether to return raw JSON output
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
      .option('json', {
        type: 'boolean',
        default: false,
        description: 'Return raw JSON from pnpm ls',
      })
      .option('since-ref', {
        type: 'string',
        description: 'Filter packages changed since git reference',
      });
  },
  handler: async (argv) => {
    const { publicOnly = false, json = false, sinceRef } = argv;

    try {
      // Get packages using our helper function
      const packages = await getWorkspacePackages({ sinceRef, publicOnly });

      if (json) {
        // Serialize packages to JSON
        console.log(JSON.stringify(packages, null, 2));
      } else {
        // Print package names only
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

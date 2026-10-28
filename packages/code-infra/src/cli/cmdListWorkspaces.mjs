#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {import('../utils/pnpm.mjs').PublicPackage} PublicPackage
 */

import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [publicOnly] - Whether to filter to only public packages
 * @property {'json'|'path'|'name'} [output] - Output format (name, path, or json)
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
        choices: ['json', 'path', 'name'],
        default: 'path',
        description:
          'Output format: name (package names), path (package paths), or json (full JSON)',
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

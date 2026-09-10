#!/usr/bin/env node

/* eslint-disable no-console */

import { resolveBaseline } from '../utils/git.mjs';

/**
 * @typedef {Object} Args
 * @property {string} [baseBranch] - Branch pull requests fork from
 * @property {boolean} [verbose] - Explain the choice on stderr
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'baseline',
  describe: 'Print the commit HEAD should be compared against',
  builder: (yargs) => {
    return yargs
      .option('base-branch', {
        type: 'string',
        description:
          'Branch pull requests fork from. Default: detected from origin/HEAD, falling back to master',
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Explain the choice on stderr',
      })
      .example(
        '$0 baseline',
        'Print the fork point from the base branch, or the previous commit when on it',
      )
      .example(
        'BASE=$($0 baseline)',
        'Capture it — only the SHA goes to stdout, so this stays substitutable',
      );
  },
  handler: async (argv) => {
    const { sha, reason } = await resolveBaseline({ baseBranch: argv.baseBranch });
    if (argv.verbose) {
      // stderr, so command substitution captures the SHA alone.
      console.error(`Baseline: ${sha} (${reason})`);
    }
    console.log(sha);
  },
});

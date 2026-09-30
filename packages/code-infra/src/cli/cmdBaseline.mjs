#!/usr/bin/env node

/* eslint-disable no-console */

import { resolveBaseline } from '../utils/git.mjs';

/**
 * @typedef {Object} Args
 * @property {string} [baseBranch] - Branch pull requests fork from
 * @property {string} [remote] - Remote the base branch is fetched from
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'baseline',
  describe: 'Print the commit HEAD should be compared against',
  builder: (yargs) => {
    return yargs
      .option('base-branch', {
        type: 'string',
        description: "Branch pull requests fork from. Default: the remote's default branch",
      })
      .option('remote', {
        type: 'string',
        description: 'Remote the base branch is fetched from. Default: upstream, else origin',
      });
  },
  handler: async (argv) => {
    console.log(await resolveBaseline({ baseBranch: argv.baseBranch, remote: argv.remote }));
  },
});

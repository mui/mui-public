#!/usr/bin/env node

/* eslint-disable no-console */

import { resolveBaseline } from '../utils/git.mjs';

/**
 * @typedef {Object} Args
 * @property {string} [baseBranch] - Branch pull requests fork from
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'baseline',
  describe: 'Print the commit HEAD should be compared against',
  builder: (yargs) => {
    return yargs.option('base-branch', {
      type: 'string',
      description: "Branch pull requests fork from. Default: the mui remote's default branch",
    });
  },
  handler: async (argv) => {
    console.log(await resolveBaseline({ baseBranch: argv.baseBranch }));
  },
});

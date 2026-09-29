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
    return yargs
      .option('base-branch', {
        type: 'string',
        description:
          "Branch pull requests fork from. Default: read from a remote's HEAD, which a CI checkout does not record",
      })
      .example(
        'BASE=$($0 baseline)',
        'Nothing but the commit is printed, so this stays substitutable',
      );
  },
  handler: async (argv) => {
    console.log(await resolveBaseline({ baseBranch: argv.baseBranch }));
  },
});

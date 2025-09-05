/* eslint-disable no-console */

import { measurePerf } from '../utils/build.mjs';

/**
 * @typedef {import('../utils/extractErrorCodes.mjs').Args} Args
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'extract-error-codes',
  describe: 'Extracts error codes from package(s).',
  builder(yargs) {
    return yargs
      .option('errorCodesPath', {
        type: 'string',
        describe: 'The output path to a json file to write the extracted error codes.',
        demandOption: true,
      })
      .option('detection', {
        type: 'string',
        describe: 'The detection strategy to use when extracting error codes.',
        choices: ['opt-in', 'opt-out'],
        default: 'opt-in',
      })
      .option('skip', {
        type: 'array',
        describe: 'List of package names to skip.',
        default: [],
      });
  },
  async handler(args) {
    console.log(`🔨 Extracting error codes`);
    const duration = await measurePerf(/** @type {string} */ (args._[0]), async () => {
      const module = await import('../utils/extractErrorCodes.mjs');
      await module.default(args);
    });
    console.log(`✅ Extracted error codes in ${(duration / 1000.0).toFixed(3)}s`);
  },
});

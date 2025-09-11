import { withPerformanceMeasurement } from '../utils/build.mjs';

/**
 * @typedef {import('../utils/extractErrorCodes.mjs').Args} Args
 */

const command = /** @type {import('yargs').CommandModule<{}, Args>} */ ({
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
    const module = await import('../utils/extractErrorCodes.mjs');
    await module.default(args);
  },
});

command.handler = withPerformanceMeasurement(
  /** @type {string} */ (command.command),
  command.handler,
  { shouldLog: true },
);

export default command;

#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'node:fs/promises';
import { globby } from 'globby';
import path from 'node:path';
import { wrapInWorker } from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [silent] Run in silent mode without logging
 */

/**
 * @param {string} message
 * @returns {string}
 */
const passMessage = (message) => `✓ ${chalk.gray(message)}`;
/**
 * @param {string} message
 * @returns {string}
 */
const failMessage = (message) => `❌ ${chalk.whiteBright(message)}`;

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'jsonlint',
  describe: 'Lint JSON files',
  builder: (yargs) => {
    return yargs.option('silent', {
      type: 'boolean',
      default: false,
      description: "Don't log file names.",
    });
  },
  handler: async (args) => {
    const cwd = process.cwd();

    const filenames = await globby('**/*.json', {
      cwd,
      gitignore: true,
      ignoreFiles: ['.lintignore'],
      ignore: ['**/tsconfig*.json'],
      followSymbolicLinks: false,
    });

    let passed = true;

    await wrapInWorker(
      async (filename) => {
        const content = await fs.readFile(path.join(cwd, filename), { encoding: 'utf8' });
        try {
          JSON.parse(content);
          if (!args.silent) {
            // eslint-disable-next-line no-console
            console.log(passMessage(filename));
          }
        } catch (error) {
          passed = false;
          console.error(failMessage(`Error parsing ${filename}:\n\n${String(error)}`));
        }
      },
      { items: filenames, defaultConcurrency: 20, promiseMethod: 'allSettled' },
    );
    if (!passed) {
      throw new Error('❌ At least one file did not pass. Check the console output');
    }
  },
});

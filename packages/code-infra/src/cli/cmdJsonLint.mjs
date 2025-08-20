#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'node:fs/promises';
import { globby } from 'globby';
import path from 'path';

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

    const fileIterator = filenames[Symbol.iterator]();
    const concurrency = Math.min(20, filenames.length);
    let passed = true;
    const workers = [];

    for (let i = 0; i < concurrency; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      const worker = Promise.resolve().then(async () => {
        for (const filename of fileIterator) {
          // eslint-disable-next-line no-await-in-loop
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
        }
      });
      workers.push(worker);
    }

    await Promise.allSettled(workers);
    if (!passed) {
      throw new Error('❌ At least one file did not pass. Check the console output');
    }
  },
});

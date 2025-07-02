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
    const lintIgnoreContent = await (async () => {
      // Reads both for backwards compatibility in the desired order
      for (const ignoreFile of ['.lintignore', '.eslintignore']) {
        const lintIgnorePath = path.join(cwd, ignoreFile);
        try {
          // eslint-disable-next-line no-await-in-loop
          return await fs.readFile(lintIgnorePath, { encoding: 'utf8' });
        } catch (ex) {
          console.error(ex);
          continue;
        }
      }
      return '';
    })();

    const lintignore = lintIgnoreContent.split(/\r?\n/).filter(Boolean);

    const filenames = await globby('**/*.json', {
      cwd,
      gitignore: true,
      ignore: [...lintignore, '**/tsconfig*.json'],
      followSymbolicLinks: false,
    });

    let passed = true;
    const checks = filenames.map(async (filename) => {
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
    });

    await Promise.allSettled(checks);
    if (!passed) {
      throw new Error('❌ At least one file did not pass. Check the console output');
    }
  },
});

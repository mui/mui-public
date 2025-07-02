#!/usr/bin/env node

/* eslint-disable no-console */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { globby } from 'globby';
import { upload } from '@argos-ci/core';

const BATCH_SIZE = 200;

/**
 * @param {any[]} array
 * @param {number} size
 * @returns {any[][]}
 */
const chunk = (array, size) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size),
  );

/**
 * @typedef {Object} Args
 * @property {boolean} [verbose] - Run with verbose logging
 * @property {string} folder - Screenshots folder path
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'argos-push',
  describe: 'Upload screenshots to Argos CI in batches',
  builder: (yargs) => {
    return yargs
      .option('folder', {
        type: 'string',
        demandOption: true,
        description: 'Path to the screenshots folder',
      })
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        default: false,
        description: 'Run with verbose logging',
      });
  },
  handler: async (argv) => {
    const { folder, verbose = false } = argv;

    // Validate required environment variables
    if (!process.env.ARGOS_TOKEN) {
      throw new Error('Missing required environment variable: ARGOS_TOKEN');
    }
    if (!process.env.CIRCLE_SHA1) {
      throw new Error('Missing required environment variable: CIRCLE_SHA1');
    }
    if (!process.env.CIRCLE_BRANCH) {
      throw new Error('Missing required environment variable: CIRCLE_BRANCH');
    }
    if (!process.env.CIRCLE_BUILD_NUM) {
      throw new Error('Missing required environment variable: CIRCLE_BUILD_NUM');
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'argos-screenshots-'));

    try {
      const screenshots = await globby(`${folder}/**/*`, {
        onlyFiles: true,
      });

      console.log(`Found ${screenshots.length} screenshots.`);
      if (verbose) {
        console.log('Screenshots found:');
        screenshots.forEach((screenshot) => {
          console.log(`  - ${screenshot}`);
        });
      }

      const chunks = chunk(screenshots, BATCH_SIZE);

      await Promise.all(
        chunks.map((screenshotChunk, chunkIndex) =>
          Promise.all(
            screenshotChunk.map(async (screenshot) => {
              const relativePath = path.relative(folder, screenshot);
              const targetPath = path.join(tempDir, `${chunkIndex}`, relativePath);
              const targetDir = path.dirname(targetPath);

              await fs.mkdir(targetDir, { recursive: true });
              await fs.copyFile(screenshot, targetPath);
            }),
          ),
        ),
      );

      for (let i = 0; i < chunks.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const result = await upload({
          root: `${tempDir}/${i}`,
          commit: process.env.CIRCLE_SHA1,
          branch: process.env.CIRCLE_BRANCH,
          token: process.env.ARGOS_TOKEN,
          parallel: {
            total: chunks.length,
            nonce: process.env.CIRCLE_BUILD_NUM,
          },
        });

        console.log(
          `Batch of ${chunks[i].length} screenshots uploaded. Build URL: ${result.build.url}`,
        );
      }
    } catch (/** @type {any} */ error) {
      console.error('Error uploading screenshots:', error.message);
      process.exit(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },
});

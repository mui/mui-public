#!/usr/bin/env node

/* eslint-disable no-console */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { globby } from 'globby';
import { upload } from '@argos-ci/core';

/**
 * Alternatve to `@argos-ci/cli` that can upload screenshots in batches.
 */

const BATCH_SIZE = 200;

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

      const batches = [];
      for (let i = 0; i < screenshots.length; i += BATCH_SIZE) {
        batches.push(screenshots.slice(i, i + BATCH_SIZE));
      }

      await Promise.all(
        batches.map((screenshotBatch, batchIndex) =>
          Promise.all(
            screenshotBatch.map(async (screenshot) => {
              const relativePath = path.relative(folder, screenshot);
              const targetPath = path.join(tempDir, `${batchIndex}`, relativePath);
              const targetDir = path.dirname(targetPath);

              await fs.mkdir(targetDir, { recursive: true });
              await fs.copyFile(screenshot, targetPath);
            }),
          ),
        ),
      );

      for (let i = 0; i < batches.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const result = await upload({
          root: `${tempDir}/${i}`,
          commit: process.env.CIRCLE_SHA1,
          branch: process.env.CIRCLE_BRANCH,
          token: process.env.ARGOS_TOKEN,
          parallel: {
            total: batches.length,
            nonce: process.env.CIRCLE_BUILD_NUM,
          },
        });

        console.log(
          `Batch of ${batches[i].length} screenshots uploaded. Build URL: ${result.build.url}`,
        );
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },
});

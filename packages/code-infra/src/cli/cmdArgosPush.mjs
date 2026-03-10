#!/usr/bin/env node

/* eslint-disable no-console */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { globby } from 'globby';
import { upload } from '@argos-ci/core';

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

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
    return yargs.option('folder', {
      type: 'string',
      demandOption: true,
      description: 'Path to the screenshots folder',
    });
  },
  handler: async (argv) => {
    const { folder, verbose = false } = argv;

    const argosToken = requireEnv('ARGOS_TOKEN');
    const circleSha1 = requireEnv('CIRCLE_SHA1');
    const circleBranch = requireEnv('CIRCLE_BRANCH');
    const circleBuildNum = requireEnv('CIRCLE_BUILD_NUM');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'argos-screenshots-'));

    try {
      const screenshots = await globby(`${folder}/**/*`, {
        onlyFiles: true,
      });
      const threshold = process.env.ARGOS_THRESHOLD ? parseFloat(process.env.ARGOS_THRESHOLD) : 0.5;

      console.log(
        `Found ${screenshots.length} screenshots. Uploading with threshold ${threshold}.`,
      );
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
          commit: circleSha1,
          branch: circleBranch,
          token: argosToken,
          threshold,
          parallel: {
            total: batches.length,
            nonce: circleBuildNum,
          },
        });

        if (verbose) {
          console.log('Screenshots uploaded:');
          for (const screenshot of result.screenshots) {
            console.log(`- ${screenshot.name}. Threshold: ${screenshot.threshold}.`);
          }
        }

        console.log(
          `Batch of ${batches[i].length} screenshots uploaded. Threshold: ${threshold}. Build URL: ${result.build.url}`,
        );
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },
});

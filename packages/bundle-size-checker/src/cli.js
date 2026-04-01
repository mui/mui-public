// @ts-check

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import yargs from 'yargs';
import { Piscina } from 'piscina';
import micromatch from 'micromatch';
import envCi from 'env-ci';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { execa } from 'execa';
import { loadConfig } from './configLoader.js';
import { uploadSnapshot } from './uploadSnapshot.js';
import { syncPrComment } from './syncPrComment.js';

/**
 * @typedef {import('./types.js').CommandLineArgs} CommandLineArgs
 * @typedef {import('./types.js').NormalizedBundleSizeCheckerConfig} NormalizedBundleSizeCheckerConfig
 * @typedef {import('./types.js').SizeSnapshotEntry} SizeSnapshotEntry
 */

/**
 */
function getCiInfo() {
  const ciInfo = envCi();
  if (!ciInfo.isCi) {
    return null;
  }
  switch (ciInfo.name) {
    case 'CircleCI':
      return ciInfo;
    default:
      throw new Error(`Unsupported CI environment: ${ciInfo.name}`);
  }
}

/**
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 */

// Default concurrency is set to the number of available CPU cores
const DEFAULT_CONCURRENCY = os.availableParallelism();

const rootDir = process.cwd();

/**
 * creates size snapshot for every bundle
 * @param {CommandLineArgs} args
 * @param {NormalizedBundleSizeCheckerConfig} config - The loaded configuration
 * @returns {Promise<Array<[string, SizeSnapshotEntry]>>}
 */
async function getBundleSizes(args, config) {
  const worker = new Piscina({
    filename: new URL('./worker.js', import.meta.url).href,
    maxThreads: args.concurrency || DEFAULT_CONCURRENCY,
  });
  // Clean and recreate the build directory
  const buildDir = path.join(rootDir, 'build');
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(buildDir, { recursive: true });

  if (
    !config ||
    !config.entrypoints ||
    !Array.isArray(config.entrypoints) ||
    config.entrypoints.length === 0
  ) {
    throw new Error(
      'No valid configuration found. Create a bundle-size-checker.config.js or bundle-size-checker.config.mjs file with entrypoints array.',
    );
  }

  // Apply filters if provided
  let validEntries = config.entrypoints;
  const filter = args.filter;
  if (filter && filter.length > 0) {
    validEntries = config.entrypoints.filter((entry) => {
      return filter.some((pattern) => {
        if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
          return micromatch.isMatch(entry.id, pattern, { nocase: true });
        }
        return entry.id.toLowerCase().includes(pattern.toLowerCase());
      });
    });

    if (validEntries.length === 0) {
      console.warn('Warning: No entries match the provided filter pattern(s).');
    }
  }

  const sizeArrays = await Promise.all(
    validEntries.map((entry, index) =>
      worker.run({ entry, args, index, total: validEntries.length, replace: config.replace }),
    ),
  );

  return sizeArrays.flat();
}

/**
 * Posts initial "in progress" PR comment via dashboard API
 * @param {NormalizedBundleSizeCheckerConfig} config - The loaded configuration
 * @returns {Promise<void>}
 */
async function postInitialPrComment(config) {
  const ciInfo = getCiInfo();

  if (!ciInfo || !ciInfo.isPr) {
    return;
  }

  // In CI PR builds, all required info must be present
  if (!ciInfo.slug || !ciInfo.pr) {
    throw new Error('PR commenting enabled but repository information missing in CI PR build');
  }

  if (!config.upload) {
    throw new Error('PR commenting requires upload configuration to determine the API URL');
  }

  const prNumber = Number(ciInfo.pr);

  try {
    // eslint-disable-next-line no-console
    console.log('Posting initial PR comment via dashboard API...');

    await syncPrComment(
      ciInfo.slug,
      prNumber,
      (await execa('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      { bundleSize: { status: 'pending' } },
    );

    // eslint-disable-next-line no-console
    console.log(`Initial PR comment posted for PR #${prNumber}`);
  } catch (/** @type {any} */ error) {
    console.error('Failed to post initial PR comment:', error.message);
    // Don't fail the build for comment failures
  }
}

/**
 * Main runner function
 * @param {CommandLineArgs} argv - Command line arguments
 */
async function run(argv) {
  const { output, concurrency } = argv;

  const snapshotDestPath = output ? path.resolve(output) : path.join(rootDir, 'size-snapshot.json');

  const config = await loadConfig(rootDir);

  // Post initial PR comment if enabled and in CI environment
  if (config && config.comment) {
    await postInitialPrComment(config);
  }

  // eslint-disable-next-line no-console
  console.log(`Starting bundle size snapshot creation with ${concurrency} workers...`);

  const bundleSizes = await getBundleSizes(argv, config);
  const sortedBundleSizes = Object.fromEntries(
    bundleSizes.sort((a, b) => a[0].localeCompare(b[0])),
  );

  // Ensure output directory exists
  await fs.mkdir(path.dirname(snapshotDestPath), { recursive: true });
  await fs.writeFile(snapshotDestPath, JSON.stringify(sortedBundleSizes, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `Bundle size snapshot written to ${chalk.underline(pathToFileURL(snapshotDestPath))}`,
  );

  // Upload the snapshot if upload configuration is provided and not null
  if (config && config.upload) {
    try {
      // eslint-disable-next-line no-console
      console.log(
        config.upload.legacyUpload
          ? 'Uploading bundle size snapshot directly to S3 (legacy)...'
          : `Uploading bundle size snapshot via dashboard API at ${config.upload.apiUrl}...`,
      );
      const { key } = await uploadSnapshot(snapshotDestPath, config.upload);
      // eslint-disable-next-line no-console
      console.log(`Bundle size snapshot uploaded to S3 with key: ${key}`);
    } catch (/** @type {any} */ error) {
      console.error('Failed to upload bundle size snapshot:', error.message);
      // Exit with error code to indicate failure
      process.exit(1);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('No upload configuration provided, skipping upload.');
  }

  // Post final PR comment via dashboard API if enabled and in CI environment
  if (config && config.comment) {
    const ciInfo = getCiInfo();

    // Skip silently if not in CI or not a PR
    if (!ciInfo || !ciInfo.isPr) {
      // eslint-disable-next-line no-console
      console.log('Not in a CI PR environment, skipping PR comment.');
      return;
    }

    // In CI PR builds, all required info must be present
    if (!ciInfo.slug || !ciInfo.pr) {
      throw new Error('PR commenting enabled but repository information missing in CI PR build');
    }

    if (!config.upload) {
      throw new Error('PR commenting requires upload configuration to determine the API URL');
    }

    const prNumber = Number(ciInfo.pr);

    // eslint-disable-next-line no-console
    console.log('Syncing PR comment via dashboard API...');

    // Get tracked bundles from config
    const trackedBundles = config.entrypoints
      .filter((entry) => entry.track === true)
      .map((entry) => entry.id);

    await syncPrComment(
      ciInfo.slug,
      prNumber,
      (await execa('git', ['rev-parse', 'HEAD'])).stdout.trim(),
      {
        bundleSize: {
          status: 'complete',
          trackedBundles: trackedBundles.length > 0 ? trackedBundles : undefined,
        },
      },
    );

    // eslint-disable-next-line no-console
    console.log(`PR comment synced for PR #${prNumber}`);
  }
}

yargs(process.argv.slice(2))
  .command(
    /** @type {import('yargs').CommandModule<{}, CommandLineArgs>} */ ({
      command: '$0',
      describe: 'Saves a size snapshot in size-snapshot.json',
      builder: (cmdYargs) => {
        return cmdYargs
          .option('analyze', {
            default: false,
            describe: 'Creates a report for each bundle.',
            type: 'boolean',
          })
          .option('verbose', {
            default: false,
            describe: 'Show more detailed information during compilation.',
            type: 'boolean',
          })
          .option('debug', {
            default: false,
            describe:
              'Build with readable output (no name mangling or whitespace collapse, but still tree-shake).',
            type: 'boolean',
          })
          .option('output', {
            alias: 'o',
            describe:
              'Path to output the size snapshot JSON file (defaults to size-snapshot.json in current directory).',
            type: 'string',
          })
          .option('filter', {
            alias: 'F',
            describe: 'Filter entry points by glob pattern(s) applied to their IDs',
            type: 'array',
          })
          .option('concurrency', {
            alias: 'c',
            describe: 'Number of workers to use for parallel processing',
            type: 'number',
            default: DEFAULT_CONCURRENCY,
          });
      },
      handler: run,
    }),
  )
  .help()
  .strict(true)
  .version(false)
  .parse();

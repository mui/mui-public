// @ts-check

import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import yargs from 'yargs';
import Piscina from 'piscina';
import micromatch from 'micromatch';
import { loadConfig } from './configLoader.js';
import { uploadSnapshot } from './uploadSnapshot.js';

/**
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 */

// Default concurrency is set to the number of available CPU cores
const DEFAULT_CONCURRENCY = os.availableParallelism();

const rootDir = process.cwd();

/**
 * creates size snapshot for every bundle that built with webpack
 * @param {CommandLineArgs} args
 * @param {NormalizedBundleSizeCheckerConfig} config - The loaded configuration
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
async function getWebpackSizes(args, config) {
  const worker = new Piscina({
    filename: new URL('./worker.js', import.meta.url).href,
    maxThreads: args.concurrency || DEFAULT_CONCURRENCY,
  });
  // Clean and recreate the build directory
  const buildDir = path.join(rootDir, 'build');
  await fse.emptyDir(buildDir);

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
      worker.run({ entry, args, index, total: validEntries.length }),
    ),
  );

  return sizeArrays.flat();
}

/**
 * Main runner function
 * @param {CommandLineArgs} argv - Command line arguments
 */
async function run(argv) {
  const { output, concurrency } = argv;

  const snapshotDestPath = output ? path.resolve(output) : path.join(rootDir, 'size-snapshot.json');

  const config = await loadConfig(rootDir);

  // eslint-disable-next-line no-console
  console.log(`Starting bundle size snapshot creation with ${concurrency} workers...`);

  const webpackSizes = await getWebpackSizes(argv, config);
  const bundleSizes = Object.fromEntries(webpackSizes.sort((a, b) => a[0].localeCompare(b[0])));

  // Ensure output directory exists
  await fse.mkdirp(path.dirname(snapshotDestPath));
  await fse.writeJSON(snapshotDestPath, bundleSizes, { spaces: 2 });

  // eslint-disable-next-line no-console
  console.log(`Bundle size snapshot written to ${snapshotDestPath}`);

  // Upload the snapshot if upload configuration is provided and not null
  if (config && config.upload) {
    try {
      // eslint-disable-next-line no-console
      console.log('Uploading bundle size snapshot to S3...');
      const { key } = await uploadSnapshot(snapshotDestPath, config.upload);
      // eslint-disable-next-line no-console
      console.log(`Bundle size snapshot uploaded to S3 with key: ${key}`);
    } catch (/** @type {any} */ error) {
      console.error('Failed to upload bundle size snapshot:', error.message);
      // Exit with error code to indicate failure
      process.exit(1);
    }
  }
}

yargs(process.argv.slice(2))
  // @ts-expect-error
  .command({
    command: '$0',
    describe: 'Saves a size snapshot in size-snapshot.json',
    builder: (cmdYargs) => {
      return cmdYargs
        .option('analyze', {
          default: false,
          describe: 'Creates a webpack-bundle-analyzer report for each bundle.',
          type: 'boolean',
        })
        .option('accurateBundles', {
          default: false,
          describe: 'Displays used bundles accurately at the cost of more CPU cycles.',
          type: 'boolean',
        })
        .option('verbose', {
          default: false,
          describe: 'Show more detailed information during compilation.',
          type: 'boolean',
        })
        .option('vite', {
          default: false,
          describe: 'Use Vite instead of webpack for bundling.',
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
  })
  .help()
  .strict(true)
  .version(false)
  .parse();

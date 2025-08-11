// @ts-check

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import yargs from 'yargs';
import { Piscina } from 'piscina';
import micromatch from 'micromatch';
import { execa } from 'execa';
import gitUrlParse from 'git-url-parse';
import { loadConfig } from './configLoader.js';
import { uploadSnapshot } from './uploadSnapshot.js';
import { renderMarkdownReport } from './renderMarkdownReport.js';
import { octokit } from './github.js';

/**
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 */

// Default concurrency is set to the number of available CPU cores
const DEFAULT_CONCURRENCY = os.availableParallelism();

const rootDir = process.cwd();

/**
 * Gets the current repository owner and name from git remote
 * @returns {Promise<{owner: string | null, repo: string | null}>}
 */
async function getCurrentRepoInfo() {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    const parsed = gitUrlParse(stdout.trim());
    return {
      owner: parsed.owner,
      repo: parsed.name,
    };
  } catch (error) {
    return {
      owner: null,
      repo: null,
    };
  }
}

/**
 * creates size snapshot for every bundle
 * @param {CommandLineArgs} args
 * @param {NormalizedBundleSizeCheckerConfig} config - The loaded configuration
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
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
      worker.run({ entry, args, index, total: validEntries.length }),
    ),
  );

  return sizeArrays.flat();
}

/**
 * Report command handler
 * @param {ReportCommandArgs} argv - Command line arguments
 */
async function reportCommand(argv) {
  const { pr, owner: argOwner, repo: argRepo } = argv;

  // Get current repo info and coerce with provided arguments
  const currentRepo = await getCurrentRepoInfo();
  const owner = argOwner ?? currentRepo.owner;
  const repo = argRepo ?? currentRepo.repo;

  if (typeof pr !== 'number') {
    throw new Error('Invalid pull request number. Please provide a valid --pr option.');
  }

  // Validate that both owner and repo are available
  if (!owner || !repo) {
    throw new Error(
      'Repository owner and name are required. Please provide --owner and --repo options, or run this command from within a git repository.',
    );
  }

  // Fetch PR information
  const { data: prInfo } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pr,
  });

  // Generate and print the markdown report
  const report = await renderMarkdownReport(prInfo);
  // eslint-disable-next-line no-console
  console.log(report);
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

  const bundleSizes = await getBundleSizes(argv, config);
  const sortedBundleSizes = Object.fromEntries(
    bundleSizes.sort((a, b) => a[0].localeCompare(b[0])),
  );

  // Ensure output directory exists
  await fs.mkdir(path.dirname(snapshotDestPath), { recursive: true });
  await fs.writeFile(snapshotDestPath, JSON.stringify(sortedBundleSizes, null, 2));

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
  .command(
    /** @type {import('yargs').CommandModule<{}, ReportCommandArgs>} */ ({
      command: 'report',
      describe: 'Generate a markdown report for a pull request',
      builder: (cmdYargs) => {
        return cmdYargs
          .option('pr', {
            describe: 'Pull request number',
            type: 'number',
            demandOption: true,
          })
          .option('owner', {
            describe: 'Repository owner (defaults to current git repo owner)',
            type: 'string',
          })
          .option('repo', {
            describe: 'Repository name (defaults to current git repo name)',
            type: 'string',
          });
      },
      handler: reportCommand,
    }),
  )
  .help()
  .strict(true)
  .version(false)
  .parse();

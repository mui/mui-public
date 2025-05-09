// @ts-check

import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import yargs from 'yargs';
import Piscina from 'piscina';
import micromatch from 'micromatch';
import { loadConfig } from './configLoader.js';
import { uploadSnapshot } from './uploadSnapshot.js';
import { calculateSizeDiff } from './sizeDiff.js';
import { renderMarkdownReportContent, renderMarkdownReport } from './renderMarkdownReport.js';
import { fetchSnapshot } from './fetchSnapshot.js';

/**
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 */

const MAX_CONCURRENCY = Math.min(8, os.cpus().length);

const rootDir = process.cwd();

/**
 * Normalizes entries to ensure they have a consistent format and ids are unique
 * @param {ObjectEntry[]} entries - The array of entries from the config
 * @returns {ObjectEntry[]} - Normalized entries with uniqueness enforced
 */
function normalizeEntries(entries) {
  const usedIds = new Set();

  return entries.map((entry) => {
    if (!entry.id) {
      throw new Error('Object entries must have an id property');
    }

    if (!entry.code && !entry.import) {
      throw new Error(`Entry "${entry.id}" must have either code or import property defined`);
    }

    if (usedIds.has(entry.id)) {
      throw new Error(`Duplicate entry id found: "${entry.id}". Entry ids must be unique.`);
    }

    usedIds.add(entry.id);

    return entry;
  });
}

/**
 * creates size snapshot for every bundle that built with webpack
 * @param {CommandLineArgs} args
 * @param {NormalizedBundleSizeCheckerConfig} config - The loaded configuration
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
async function getWebpackSizes(args, config) {
  const worker = new Piscina({
    filename: new URL('./worker.js', import.meta.url).href,
    maxThreads: MAX_CONCURRENCY,
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

  // Normalize and validate entries
  const entries = normalizeEntries(config.entrypoints);

  // Apply filters if provided
  let validEntries = entries;
  const filter = args.filter;
  if (filter && filter.length > 0) {
    validEntries = entries.filter((entry) => micromatch.isMatch(entry.id, filter));

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
  const { analyze, accurateBundles, output, verbose, filter } = argv;

  const snapshotDestPath = output ? path.resolve(output) : path.join(rootDir, 'size-snapshot.json');

  const config = await loadConfig(rootDir);

  // Pass the filter patterns to getWebpackSizes if provided
  const webpackSizes = await getWebpackSizes({ analyze, accurateBundles, verbose, filter }, config);
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

/**
 * Resolves a file path that can be relative or absolute
 * @param {string} filePath - The file path to resolve
 * @returns {string} The resolved absolute path
 */
function resolveFilePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(rootDir, filePath);
}

/**
 * Checks if a string is a URL
 * @param {string} str - The string to check
 * @returns {boolean} Whether the string is a URL
 */
function isUrl(str) {
  try {
    // eslint-disable-next-line no-new
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads a snapshot from a URL (http:, https:, or file: scheme)
 * @param {string} source - The source URL
 * @returns {Promise<SizeSnapshot>} The loaded snapshot
 */
async function loadSnapshot(source) {
  // Check if it's a valid URL
  if (!isUrl(source)) {
    throw new Error(`Invalid URL: ${source}. Use file:, http:, or https: schemes.`);
  }

  if (source.startsWith('file:')) {
    // Handle file: URL
    // Remove file: prefix and handle the rest as a file path
    // For file:///absolute/path
    let filePath = source.substring(source.indexOf('file:') + 5);

    // Remove leading slashes for absolute paths on this machine
    while (
      filePath.startsWith('/') &&
      !path.isAbsolute(filePath.substring(1)) &&
      filePath.length > 1
    ) {
      filePath = filePath.substring(1);
    }

    // Now resolve the path
    filePath = resolveFilePath(filePath);

    try {
      return await fse.readJSON(filePath);
    } catch (/** @type {any} */ error) {
      throw new Error(`Failed to read snapshot from ${filePath}: ${error.message}`);
    }
  }

  // HTTP/HTTPS URL - fetch directly
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot from ${source}: ${response.statusText}`);
  }
  const body = await response.json();
  return body;
}

/**
 * Handler for the diff command
 * @param {DiffCommandArgs} argv - Command line arguments
 */
async function diffHandler(argv) {
  const { base, head = 'file:./size-snapshot.json', output, reportUrl } = argv;

  if (!base) {
    console.error('The --base option is required');
    process.exit(1);
  }

  try {
    // Load snapshots
    // eslint-disable-next-line no-console
    console.log(`Loading base snapshot from ${base}...`);
    const baseSnapshot = await loadSnapshot(base);

    // eslint-disable-next-line no-console
    console.log(`Loading head snapshot from ${head}...`);
    const headSnapshot = await loadSnapshot(head);

    // Calculate diff
    const comparison = calculateSizeDiff(baseSnapshot, headSnapshot);

    // Output
    if (output === 'markdown') {
      // Generate markdown with optional report URL
      let markdownContent = renderMarkdownReportContent(comparison);

      // Add report URL if provided
      if (reportUrl) {
        markdownContent += `\n\n[Details of bundle changes](${reportUrl})`;
      }

      // eslint-disable-next-line no-console
      console.log(markdownContent);
    } else {
      // Default JSON output
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(comparison, null, 2));
    }
  } catch (/** @type {any} */ error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Fetches GitHub PR information
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<PrInfo>} PR information
 */
async function fetchPrInfo(owner, repo, prNumber) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  try {
    // eslint-disable-next-line no-console
    console.log(`Fetching PR info from ${url}...`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (/** @type {any} */ error) {
    console.error(`Failed to fetch PR info: ${error.message}`);
    throw error;
  }
}

/**
 * Handler for the pr command
 * @param {PrCommandArgs} argv - Command line arguments
 */
async function prHandler(argv) {
  const { prNumber, circleci, output } = argv;

  try {
    // Load the config to get the repository information
    const config = await loadConfig(rootDir);

    if (!config.upload) {
      throw new Error(
        'Upload is not configured. Please enable it in your bundle-size-checker config.',
      );
    }

    // Extract owner and repo from repository config
    const [owner, repo] = config.upload.repo.split('/');

    if (!owner || !repo) {
      throw new Error(
        `Invalid repository format in config: ${config.upload.repo}. Expected format: "owner/repo"`,
      );
    }

    // Fetch PR information from GitHub
    const prInfo = await fetchPrInfo(owner, repo, prNumber);

    // Generate the report
    // eslint-disable-next-line no-console
    console.log('Generating bundle size report...');
    const report = await renderMarkdownReport(prInfo, circleci);

    // Output
    if (output === 'markdown') {
      // eslint-disable-next-line no-console
      console.log(report);
    } else {
      // For JSON we need to load the snapshots and calculate differences
      const baseCommit = prInfo.base.sha;
      const prCommit = prInfo.head.sha;

      // eslint-disable-next-line no-console
      console.log(`Fetching base snapshot for commit ${baseCommit}...`);
      // eslint-disable-next-line no-console
      console.log(`Fetching PR snapshot for commit ${prCommit}...`);

      const [baseSnapshot, prSnapshot] = await Promise.all([
        fetchSnapshot(config.upload.repo, baseCommit).catch(() => ({})),
        fetchSnapshot(config.upload.repo, prCommit).catch(() => ({})),
      ]);

      const comparison = calculateSizeDiff(baseSnapshot, prSnapshot);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(comparison, null, 2));
    }
  } catch (/** @type {any} */ error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
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
        });
    },
    handler: run,
  })
  // @ts-expect-error
  .command({
    command: 'diff',
    describe: 'Compare two bundle size snapshots',
    builder: (cmdYargs) => {
      return cmdYargs
        .option('base', {
          describe: 'Base snapshot URL (file:, http:, or https: scheme)',
          type: 'string',
          demandOption: true,
        })
        .option('head', {
          describe:
            'Head snapshot URL (file:, http:, or https: scheme), defaults to file:./size-snapshot.json',
          type: 'string',
          default: 'file:./size-snapshot.json',
        })
        .option('output', {
          alias: 'o',
          describe: 'Output format (json or markdown)',
          type: 'string',
          choices: ['json', 'markdown'],
          default: 'json',
        })
        .option('reportUrl', {
          describe: 'URL to the detailed report (optional)',
          type: 'string',
        });
    },
    handler: diffHandler,
  })
  // @ts-expect-error
  .command({
    command: 'pr <prNumber>',
    describe: 'Generate a bundle size report for a GitHub pull request',
    builder: (cmdYargs) => {
      return cmdYargs
        .positional('prNumber', {
          describe: 'GitHub pull request number',
          type: 'number',
          demandOption: true,
        })
        .option('output', {
          alias: 'o',
          describe: 'Output format (json or markdown)',
          type: 'string',
          choices: ['json', 'markdown'],
          default: 'markdown', // Default to markdown for PR reports
        })
        .option('circleci', {
          describe: 'CircleCI build number for the report URL (optional)',
          type: 'string',
        });
    },
    handler: prHandler,
  })
  .help()
  .strict(true)
  .version(false)
  .parse();

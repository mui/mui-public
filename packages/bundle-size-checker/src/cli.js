// @ts-check

import path from 'path';
import os from 'os';
import fse from 'fs-extra';
import yargs from 'yargs';
import Piscina from 'piscina';
import { loadConfig } from './configLoader.js';
import { uploadSnapshot } from './uploadSnapshot.js';
import { calculateSizeDiff } from './sizeDiff.js';
import { renderMarkdownReportContent, renderMarkdownReport } from './renderMarkdownReport.js';

const MAX_CONCURRENCY = Math.min(8, os.cpus().length);

const rootDir = process.cwd();

/**
 * creates size snapshot for every bundle that built with webpack
 * @param {CommandLineArgs} args
 * @param {BundleSizeCheckerConfig} config - The loaded configuration
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

  const entries = config.entrypoints;
  const uniqueEntries = new Set(entries);

  const sizeArrays = await Promise.all(
    Array.from(uniqueEntries, (entry, index) =>
      worker.run({ entry, args, index, total: uniqueEntries.size }),
    ),
  );

  return sizeArrays.flat();
}

/**
 * Main runner function
 * @param {CommandLineArgs} argv - Command line arguments
 */
async function run(argv) {
  const { analyze, accurateBundles, output } = argv;

  const snapshotDestPath = output ? path.resolve(output) : path.join(rootDir, 'size-snapshot.json');

  const config = await loadConfig(rootDir);

  const webpackSizes = await getWebpackSizes({ analyze, accurateBundles }, config);
  const bundleSizes = Object.fromEntries(webpackSizes.sort((a, b) => a[0].localeCompare(b[0])));

  // Ensure output directory exists
  await fse.mkdirp(path.dirname(snapshotDestPath));
  await fse.writeJSON(snapshotDestPath, bundleSizes, { spaces: 2 });

  // eslint-disable-next-line no-console
  console.log(`Bundle size snapshot written to ${snapshotDestPath}`);

  // Upload the snapshot if upload configuration is provided
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
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Loads a snapshot from a URL (http:, https:, or file: scheme)
 * @param {string} source - The source URL
 * @returns {Promise<object>} The loaded snapshot
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
    } catch (error) {
      throw new Error(`Failed to read snapshot from ${filePath}: ${error.message}`);
    }
  }

  // HTTP/HTTPS URL - fetch directly
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot from ${source}: ${response.statusText}`);
  }
  return await response.json();
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
    console.log(`Loading base snapshot from ${base}...`);
    const baseSnapshot = await loadSnapshot(base);

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

      console.log(markdownContent);
    } else {
      // Default JSON output
      console.log(JSON.stringify(comparison, null, 2));
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Fetches GitHub PR information
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<Object>} PR information
 */
async function fetchPrInfo(owner, repo, prNumber) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  // Create request with auth token if available
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  }

  try {
    console.log(`Fetching PR info from ${url}...`);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch PR info: ${error.message}`);
    throw error;
  }
}

/**
 * Handler for the pr command
 * @param {PrCommandArgs} argv - Command line arguments
 */
async function prHandler(argv) {
  const { 'pr-number': prNumber, circleci, output } = argv;

  try {
    // Load the config to get the project information
    const config = await loadConfig(rootDir);

    if (!config.upload || !config.upload.project) {
      throw new Error(
        'No project configuration found in bundle-size-checker config. Please add upload.project (e.g., "mui/material-ui").',
      );
    }

    // Extract owner and repo from project config
    const [owner, repo] = config.upload.project.split('/');

    if (!owner || !repo) {
      throw new Error(
        `Invalid project format in config: ${config.upload.project}. Expected format: "owner/repo"`,
      );
    }

    // Fetch PR information from GitHub
    const prInfo = await fetchPrInfo(owner, repo, prNumber);

    // Generate the report
    console.log('Generating bundle size report...');
    const report = await renderMarkdownReport(prInfo, circleci);

    // Output
    if (output === 'markdown') {
      console.log(report);
    } else {
      // For JSON we need to load the snapshots and calculate differences
      const baseCommit = prInfo.base.sha;
      const prCommit = prInfo.head.sha;

      console.log(`Fetching base snapshot for commit ${baseCommit}...`);
      console.log(`Fetching PR snapshot for commit ${prCommit}...`);

      const [baseSnapshot, prSnapshot] = await Promise.all([
        fetchSnapshot(config.upload.project, baseCommit).catch(() => ({})),
        fetchSnapshot(config.upload.project, prCommit).catch(() => ({})),
      ]);

      const comparison = calculateSizeDiff(baseSnapshot, prSnapshot);
      console.log(JSON.stringify(comparison, null, 2));
    }
  } catch (error) {
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
        .option('output', {
          alias: 'o',
          describe:
            'Path to output the size snapshot JSON file (defaults to size-snapshot.json in current directory).',
          type: 'string',
        });
    },
    handler: run,
  })
  // Add diff command
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
  // Add PR command
  .command({
    command: 'pr <pr-number>',
    describe: 'Generate a bundle size report for a GitHub pull request',
    builder: (cmdYargs) => {
      return cmdYargs
        .positional('pr-number', {
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

import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import * as module from 'module';
import { byteSizeFormatter } from './formatUtils.js';
import { getWebpackSizes } from './webpack-utils.js';

const rootDir = process.cwd();

/**
 * Attempts to extract peer dependencies from a package's package.json
 * @param {string} packageName - Package to extract peer dependencies from
 * @returns {Promise<string[]|null>} - Array of peer dependency package names or null if not found
 */
async function getPeerDependencies(packageName) {
  try {
    /** @type {string | undefined} */
    let packageJsonPath;

    if (module.findPackageJSON) {
      // findPackageJSON was added in: v23.2.0, v22.14.0
      packageJsonPath = module.findPackageJSON(packageName, `${rootDir}/_.js`);
    } else {
      // Try to resolve packageName/package.json
      packageJsonPath = require.resolve(`${packageName}/package.json`, {
        paths: [rootDir],
      });
    }

    if (!packageJsonPath) {
      return null;
    }

    // Read and parse the package.json
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    // Extract peer dependencies
    if (packageJson.peerDependencies) {
      return Object.keys(packageJson.peerDependencies);
    }

    return null;
  } catch (/** @type {any} */ error) {
    console.warn(
      chalk.yellow(
        `Could not resolve peer dependencies for ${chalk.bold(packageName)}: ${error.message}`,
      ),
    );
    return null;
  }
}

/**
 * Get sizes for a bundle
 * @param {{ entry: ObjectEntry, args: CommandLineArgs, index: number, total: number }} options
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
export default async function getSizes({ entry, args, index, total }) {
  // eslint-disable-next-line no-console -- process monitoring
  console.log(chalk.blue(`Compiling ${index + 1}/${total}: ${chalk.bold(`[${entry.id}]`)}`));

  // Process peer dependencies if externals aren't specified but import is
  if (entry.import && !entry.externals) {
    const packageRoot = entry.import
      .split('/')
      .slice(0, entry.import.startsWith('@') ? 2 : 1)
      .join('/');
    const packageExternals = await getPeerDependencies(packageRoot);

    // Generate externals based on priorities:
    // 1. Explicitly defined externals in the entry object
    // 2. Peer dependencies from package.json if available
    // 3. Default externals (react, react-dom)
    entry.externals = packageExternals ?? ['react', 'react-dom'];
  } else if (!entry.externals) {
    // Set default externals if not specified
    entry.externals = ['react', 'react-dom'];
  }

  try {
    // Get webpack sizes
    const sizeMap = await getWebpackSizes(entry, args);

    // Create a concise log message showing import details
    let entryDetails = '';
    if (entry.code) {
      entryDetails = 'code import';
    } else if (entry.import) {
      entryDetails = `${entry.import}`;
      if (entry.importedNames && entry.importedNames.length > 0) {
        entryDetails += ` [${entry.importedNames.join(', ')}]`;
      } else {
        entryDetails += ' [*]';
      }
    }

    // Print a summary with all the requested information
    // Get the size entry for this entry.id from the map
    const entrySize = sizeMap.get(entry.id) || { parsed: 0, gzip: 0 };
    // eslint-disable-next-line no-console -- process monitoring
    console.log(
      `
${chalk.green('✓')} ${chalk.green.bold(`Completed ${index + 1}/${total}: [${entry.id}]`)}
  ${chalk.cyan('Import:')}    ${entryDetails}
  ${chalk.cyan('Externals:')} ${entry.externals.join(', ')}
  ${chalk.cyan('Sizes:')}     ${chalk.yellow(byteSizeFormatter.format(entrySize.parsed))} (${chalk.yellow(byteSizeFormatter.format(entrySize.gzip))} gzipped)
${args.analyze ? `  ${chalk.cyan('Analysis:')}  ${chalk.underline(pathToFileURL(path.join(rootDir, 'build', `${entry.id}.html`)).href)}` : ''}
`.trim(),
    );

    // Convert the Map to an array of entries for the return value
    return Array.from(sizeMap.entries());
  } catch (error) {
    // eslint-disable-next-line no-console -- process monitoring
    console.error(chalk.red(`Error processing bundle for ${entry.id}:`), error);
    throw error;
  }
}

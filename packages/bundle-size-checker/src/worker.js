import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import webpackCallbackBased from 'webpack';
import CompressionPlugin from 'compression-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import { byteSizeFormatter } from './formatUtils.js';

/**
 * @type {(options: webpackCallbackBased.Configuration) => Promise<webpackCallbackBased.Stats>}
 */
// @ts-expect-error Can't select the right overload
const webpack = promisify(webpackCallbackBased);
const rootDir = process.cwd();
const require = createRequire(import.meta.url);

// Type declarations are now in types.d.ts

/**
 * Attempts to extract peer dependencies from a package's package.json
 * @param {string} packageName - Package to extract peer dependencies from
 * @returns {Promise<string[]|null>} - Array of peer dependency package names or null if not found
 */
async function getPeerDependencies(packageName) {
  try {
    // Try to resolve packageName/package.json
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [rootDir],
    });

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
 * Creates webpack configuration for bundle size checking
 * @param {ObjectEntry} entry - Entry point (string or object)
 * @param {CommandLineArgs} args
 * @returns {Promise<{configuration: import('webpack').Configuration, externalsArray: string[]}>}
 */
async function createWebpackConfig(entry, args) {
  const analyzerMode = args.analyze ? 'static' : 'disabled';
  const concatenateModules = !args.accurateBundles;

  const entryName = entry.id;
  let entryContent;
  let packageExternals = null;

  // Process peer dependencies if externals aren't specified but import is
  if (entry.import && !entry.externals) {
    const packageRoot = entry.import
      .split('/')
      .slice(0, entry.import.startsWith('@') ? 2 : 1)
      .join('/');
    packageExternals = await getPeerDependencies(packageRoot);
  }

  if (entry.code && (entry.import || entry.importedNames)) {
    console.warn(
      `Warning: Both code and import/importedNames are defined for entry "${entry.id}". Using code property.`,
    );
    entryContent = entry.code;
  } else if (entry.code) {
    entryContent = entry.code;
  } else if (entry.import) {
    if (entry.importedNames && entry.importedNames.length > 0) {
      // Generate named imports for each name in the importedNames array
      const imports = entry.importedNames
        .map((name) => `import { ${name} } from '${entry.import}';`)
        .join('\n');
      const logs = entry.importedNames.map((name) => `console.log(${name});`).join('\n');
      entryContent = `${imports}\n${logs}`;
    } else {
      // Default to import * as if importedNames is not defined
      entryContent = `import * as _ from '${entry.import}';\nconsole.log(_);`;
    }
  } else {
    throw new Error(`Entry "${entry.id}" must have either code or import property defined`);
  }

  /**
   * Generate externals function from an array of package names
   * @param {string[]} packages - Array of package names to exclude (defaults to react and react-dom)
   * @returns {function} - Function to determine if a request should be treated as external
   */
  function createExternalsFunction(packages = ['react', 'react-dom']) {
    /**
     * Check if a request should be treated as external
     * Uses the new recommended format to avoid deprecation warnings
     * @param {{ context: string, request: string }} params - Object containing context and request
     * @param {Function} callback - Callback to handle the result
     */
    return ({ request }, callback) => {
      // Iterate through all packages and check if request is equal to or starts with package + '/'
      for (const pkg of packages) {
        if (request === pkg || request.startsWith(`${pkg}/`)) {
          return callback(null, `commonjs ${request}`);
        }
      }

      return callback();
    };
  }

  // Generate externals based on priorities:
  // 1. Explicitly defined externals in the entry object
  // 2. Peer dependencies from package.json if available
  // 3. Default externals (react, react-dom)
  const externalsArray =
    typeof entry === 'object' && entry.externals
      ? entry.externals
      : (packageExternals ?? ['react', 'react-dom']);

  /**
   * @type {import('webpack').Configuration}
   */
  const configuration = {
    externals: [
      // @ts-expect-error -- webpack types are not compatible with the current version
      createExternalsFunction(externalsArray),
    ],
    mode: 'production',
    optimization: {
      concatenateModules,
      minimizer: [
        new TerserPlugin({
          test: /\.m?js(\?.*)?$/i,
          // Avoid creating LICENSE.txt files for each module
          // See https://github.com/webpack-contrib/terser-webpack-plugin#remove-comments
          terserOptions: {
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [require.resolve('css-loader')],
        },
        {
          test: /\.(png|svg|jpg|gif)$/,
          use: [require.resolve('file-loader')],
        },
      ],
    },
    output: {
      filename: '[name].js',
      library: {
        // TODO: Use `type: 'module'` once it is supported (currently incompatible with `externals`)
        name: 'M',
        type: 'var',
        // type: 'module',
      },
      path: path.join(rootDir, 'build'),
    },
    plugins: [
      new CompressionPlugin({
        filename: '[path][base][fragment].gz',
      }),
      new BundleAnalyzerPlugin({
        analyzerMode,
        // We create a report for each bundle so around 120 reports.
        // Opening them all is spam.
        // If opened with `webpack --config . --analyze` it'll still open one new tab though.
        openAnalyzer: false,
        // '[name].html' not supported: https://github.com/webpack-contrib/webpack-bundle-analyzer/issues/12
        reportFilename: `${entryName}.html`,
      }),
    ],
    // A context to the current dir, which has a node_modules folder with workspace dependencies
    context: rootDir,
    entry: {
      // This format is a data: url combined with inline matchResource to obtain a virtual entry.
      // See https://github.com/webpack/webpack/issues/6437#issuecomment-874466638
      // See https://webpack.js.org/api/module-methods/#import
      // See https://webpack.js.org/api/loaders/#inline-matchresource
      [entryName]: `./index.js!=!data:text/javascript;charset=utf-8;base64,${Buffer.from(entryContent.trim()).toString('base64')}`,
    },
    // TODO: 'browserslist:modern'
    // See https://github.com/webpack/webpack/issues/14203
    target: 'web',
  };

  // Return both the configuration and the externals array
  return { configuration, externalsArray };
}

/**
 * Get sizes for a bundle
 * @param {{ entry: ObjectEntry, args: CommandLineArgs, index: number, total: number }} options
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
export default async function getSizes({ entry, args, index, total }) {
  /** @type {Map<string, { parsed: number, gzip: number }>} */
  const sizeMap = new Map();

  // Create webpack configuration (now async to handle peer dependency resolution)
  const { configuration, externalsArray } = await createWebpackConfig(entry, args);

  // eslint-disable-next-line no-console -- process monitoring
  console.log(chalk.blue(`Compiling ${index + 1}/${total}: ${chalk.bold(`[${entry.id}]`)}`));

  const webpackStats = await webpack(configuration);

  if (!webpackStats) {
    throw new Error('No webpack stats were returned');
  }

  if (webpackStats.hasErrors()) {
    const statsJson = webpackStats.toJson({
      all: false,
      entrypoints: true,
      errors: true,
    });

    const entrypointKeys = statsJson.entrypoints ? Object.keys(statsJson.entrypoints) : [];

    throw new Error(
      `${chalk.red.bold('ERROR:')} The following errors occurred during bundling of ${chalk.yellow(entrypointKeys.join(', '))} with webpack: \n${(
        statsJson.errors || []
      )
        .map((error) => {
          return `${JSON.stringify(error, null, 2)}`;
        })
        .join('\n')}`,
    );
  }

  const stats = webpackStats.toJson({
    all: false,
    assets: true,
    entrypoints: true,
    relatedAssets: true,
  });

  if (!stats.assets) {
    return Array.from(sizeMap.entries());
  }

  const assets = new Map(stats.assets.map((asset) => [asset.name, asset]));

  if (stats.entrypoints) {
    Object.values(stats.entrypoints).forEach((entrypoint) => {
      let parsedSize = 0;
      let gzipSize = 0;

      if (entrypoint.assets) {
        entrypoint.assets.forEach(({ name, size }) => {
          const asset = assets.get(name);
          if (asset && asset.related) {
            const gzippedAsset = asset.related.find((relatedAsset) => {
              return relatedAsset.type === 'gzipped';
            });

            if (size !== undefined) {
              parsedSize += size;
            }

            if (gzippedAsset && gzippedAsset.size !== undefined) {
              gzipSize += gzippedAsset.size;
            }
          }
        });
      }

      if (!entrypoint.name) {
        throw new Error('Entrypoint name is undefined');
      }

      sizeMap.set(entrypoint.name, { parsed: parsedSize, gzip: gzipSize });
    });
  }

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
  ${chalk.cyan('Externals:')} ${externalsArray.join(', ')}
  ${chalk.cyan('Sizes:')}     ${chalk.yellow(byteSizeFormatter.format(entrySize.parsed))} (${chalk.yellow(byteSizeFormatter.format(entrySize.gzip))} gzipped)
${args.analyze ? `  ${chalk.cyan('Analysis:')}  ${chalk.underline(path.join(rootDir, 'build', `${entry.id}.html`))}` : ''}
`,
  );

  // Convert the Map to an array of entries for the return value
  return Array.from(sizeMap.entries());
}

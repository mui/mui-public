import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import webpackCallbackBased from 'webpack';
import CompressionPlugin from 'compression-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { createRequire } from 'node:module';

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
    const packageJsonPath = require.resolve(`${packageName}/package.json`);

    // Read and parse the package.json
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    // Extract peer dependencies
    if (packageJson.peerDependencies) {
      return Object.keys(packageJson.peerDependencies);
    }

    return null;
  } catch (error) {
    console.warn(`Could not resolve peer dependencies for ${packageName}`);
    return null;
  }
}

/**
 * Creates webpack configuration for bundle size checking
 * @param {ObjectEntry} entry - Entry point (string or object)
 * @param {CommandLineArgs} args
 * @returns {Promise<import('webpack').Configuration>}
 */
async function createWebpackConfig(entry, args) {
  const analyzerMode = args.analyze ? 'static' : 'disabled';
  const concatenateModules = !args.accurateBundles;

  const entryName = entry.id;
  let entryContent;
  let packageExternals = null;

  // Process peer dependencies if externals aren't specified but import is
  if (entry.import && !entry.externals) {
    packageExternals = await getPeerDependencies(entry.import);
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
   * Escapes string for use in a regular expression
   * Similar to the non-standard RegExp.escape that might be added in the future
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape
   * @param {string} string - The string to be escaped
   * @returns {string} - The escaped string
   */
  function escapeRegExp(string) {
    // $& means the whole matched string
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Generate externals RegExp pattern from an array of package names
   * @param {string[]} packages - Array of package names to exclude (defaults to react and react-dom)
   * @returns {RegExp} - RegExp to exclude the packages
   */
  function generateExternalsRegex(packages) {
    // Escape any regex special characters
    const escapedPackages = packages.map((pkg) => escapeRegExp(pkg));

    // Create a pattern that matches each package name exactly and also handles subpaths
    // e.g. 'react' should match 'react' and 'react/something' but not 'react-dom'
    const pattern = `^(${escapedPackages.join('|')})(/.*)?$`;
    return new RegExp(pattern);
  }

  /**
   * @type {import('webpack').Configuration}
   */
  const configuration = {
    // Generate externals based on priorities:
    // 1. Explicitly defined externals in the entry object
    // 2. Peer dependencies from package.json if available
    // 3. Default externals (react, react-dom)
    externals:
      typeof entry === 'object' && entry.externals
        ? generateExternalsRegex(entry.externals)
        : generateExternalsRegex(packageExternals ?? ['react', 'react-dom']),
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

  return configuration;
}

/**
 * Get sizes for a bundle
 * @param {{ entry: ObjectEntry, args: CommandLineArgs, index: number, total: number }} options
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
export default async function getSizes({ entry, args, index, total }) {
  /** @type {Array<[string, { parsed: number, gzip: number }]>} */
  const sizes = [];

  // Create webpack configuration (now async to handle peer dependency resolution)
  const configuration = await createWebpackConfig(entry, args);

  // Display appropriate entry information for logging
  const displayEntry = typeof entry === 'string' ? entry : entry.id;

  // eslint-disable-next-line no-console -- process monitoring
  console.log(`Compiling ${index + 1}/${total}: "${displayEntry}"`);

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
      `The following errors occurred during bundling of ${entrypointKeys.join(', ')} with webpack: \n${(
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
    return sizes;
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

      sizes.push([entrypoint.name, { parsed: parsedSize, gzip: gzipSize }]);
    });
  }

  return sizes;
}

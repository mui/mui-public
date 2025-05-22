import { promisify } from 'util';
import path from 'path';
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

  if (entry.code && (entry.import || entry.importedNames)) {
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

  // Use externals from the entry object
  const externalsArray = entry.externals || ['react', 'react-dom'];

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
          test: /\.[jt]sx?$/,
          include: rootDir,
          exclude: /node_modules/,
          use: {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                require.resolve('@babel/preset-react'),
                require.resolve('@babel/preset-typescript'),
              ],
            },
          },
        },
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
        logLevel: 'warn',
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
 * Process webpack stats to extract bundle sizes
 * @param {import('webpack').Stats} webpackStats - The webpack stats object
 * @returns {Map<string, { parsed: number, gzip: number }>} - Map of bundle names to size information
 */
function processBundleSizes(webpackStats) {
  /** @type {Map<string, { parsed: number, gzip: number }>} */
  const sizeMap = new Map();

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
      `ERROR: The following errors occurred during bundling of ${entrypointKeys.join(', ')} with webpack: \n${(
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
    return sizeMap;
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

  return sizeMap;
}

/**
 * Get sizes for a webpack bundle
 * @param {ObjectEntry} entry - The entry configuration
 * @param {CommandLineArgs} args - Command line arguments
 * @returns {Promise<Map<string, { parsed: number, gzip: number }>>}
 */
export async function getWebpackSizes(entry, args) {
  // Create webpack configuration
  const { configuration } = await createWebpackConfig(entry, args);

  // Run webpack
  const webpackStats = await webpack(configuration);

  // Process the webpack stats to get bundle sizes
  return processBundleSizes(webpackStats);
}

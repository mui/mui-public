import { promisify } from 'util';
import path from 'path';
import webpackCallbackBased from 'webpack';
import CompressionPlugin from 'compression-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { createRequire } from 'module';

/**
 * @type {(options: webpackCallbackBased.Configuration) => Promise<webpackCallbackBased.Stats>}
 */
// @ts-expect-error Can't select the right overload
const webpack = promisify(webpackCallbackBased);
const rootDir = process.cwd();
const require = createRequire(import.meta.url);

// Type declarations are now in types.d.ts

/**
 * Creates webpack configuration for bundle size checking
 * @param {EntryPoint} entry - Entry point (string or object)
 * @param {CommandLineArgs} args
 * @returns {import('webpack').Configuration}
 */
function createWebpackConfig(entry, args) {
  const analyzerMode = args.analyze ? 'static' : 'disabled';
  const concatenateModules = !args.accurateBundles;

  let entryName;
  let entryContent;

  if (typeof entry === 'string') {
    // Handle string entry (backward compatibility)
    entryName = entry;
    const [importSrc, importName] = entry.split('#');

    entryContent = importName
      ? `import { ${importName} } from '${importSrc}';console.log(${importName});`
      : `import * as _ from '${importSrc}';console.log(_);`;
  } else {
    // Handle object entry with id and other properties
    entryName = entry.id;
    
    if (entry.code && (entry.import || entry.importedNames)) {
      console.warn(`Warning: Both code and import/importedNames are defined for entry "${entry.id}". Using code property.`);
      entryContent = entry.code;
    } else if (entry.code) {
      entryContent = entry.code;
    } else if (entry.import) {
      if (entry.importedNames && entry.importedNames.length > 0) {
        // Generate named imports for each name in the importedNames array
        const imports = entry.importedNames.map(name => `import { ${name} } from '${entry.import}';`).join('\n');
        const logs = entry.importedNames.map(name => `console.log(${name});`).join('\n');
        entryContent = `${imports}\n${logs}`;
      } else {
        // Default to import * as if importedNames is not defined
        entryContent = `import * as _ from '${entry.import}';\nconsole.log(_);`;
      }
    } else {
      throw new Error(`Entry "${entry.id}" must have either code or import property defined`);
    }
  }

  /**
   * @type {import('webpack').Configuration}
   */
  const configuration = {
    // ideally this would be computed from the bundles peer dependencies
    // Ensure that `react` as well as `react/*` are considered externals but not `react*`
    externals: /^(date-fns|dayjs|luxon|moment|react|react-dom)(\/.*)?$/,
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
 * @param {{ entry: EntryPoint, args: CommandLineArgs, index: number, total: number }} options
 * @returns {Promise<Array<[string, { parsed: number, gzip: number }]>>}
 */
export default async function getSizes({ entry, args, index, total }) {
  /** @type {Array<[string, { parsed: number, gzip: number }]>} */
  const sizes = [];

  const configuration = createWebpackConfig(entry, args);

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

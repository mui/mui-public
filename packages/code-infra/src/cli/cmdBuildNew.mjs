/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { markFn, measureFn, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 * @property {boolean} verbose
 * @property {boolean} skipTypes
 * @property {boolean} sourceMap
 * @property {string[]} [copy]
 * @property {boolean} enableReactCompiler
 */

/**
 * @typedef {Partial<import('../../package.json')>} PackageJson
 */

/**
 * @type {import('../utils/build.mjs').BundleType[]}
 */
const validBundles = ['esm', 'cjs'];

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Builds the package for publishing.',
  builder: (yargs) =>
    yargs
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
        default: ['esm', 'cjs'],
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging.',
      })
      .option('skipTypes', {
        type: 'boolean',
        default: false,
        description: 'Whether to skip building types for the package.',
      })
      .option('sourceMap', {
        type: 'boolean',
        default: false,
        description: 'Enable source maps for the build.',
      })
      .option('copy', {
        type: 'string',
        array: true,
        description:
          'Files/Directories to be copied to the output directory. Can be a glob pattern.',
        default: [],
      })
      .option('enableReactCompiler', {
        type: 'boolean',
        default: false,
        description: 'Whether to use the React compiler.',
      }),
  async handler(args) {
    let pkgName = '';
    await markFn('build-new', async () => {
      const cwd = process.cwd();
      const pkgJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
      await validatePkgJson(pkgJson, {
        enableReactCompiler: args.enableReactCompiler,
        skipBabelRuntimeCheck: true, // this check is done in tsdown build
      });
      pkgName = pkgJson.name;

      await import('../bundlers/tsdown.mjs').then(({ build }) => build(args, pkgJson));
    });
    console.log(
      `✅ Built "${pkgName}" in ${(measureFn('build-new').duration / 1000).toFixed(3)}s.`,
    );
  },
});

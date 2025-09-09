/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { markFn, measureFn, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {import('./cmdBuild.mjs').Args & {watch?: boolean}} BaseArgs
 */

/**
 * @typedef {BaseArgs & { bundler: 'tsdown' | 'rslib'}} Args
 */

/**
 * @typedef {Partial<import('../../package.json')>} PackageJson
 */

/**
 * @type {import('../utils/build.mjs').BundleType[]}
 */
const validBundles = ['esm', 'cjs'];

/**
 * @type {Args['bundler'][]}
 */
const validBundlers = ['tsdown', 'rslib'];

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Builds the package for publishing.',
  builder(yargs) {
    return yargs
      .option('bundler', {
        demandOption: true,
        type: 'string',
        choices: validBundlers,
        description: 'The bundler to use for building the package.',
        default: 'tsdown',
      })
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
        default: ['esm', 'cjs'],
      })
      .option('hasLargeFiles', {
        type: 'boolean',
        default: false,
        describe: 'Set to `true` if you know you are transpiling large files.',
      })
      .option('skipBundlePackageJson', {
        type: 'boolean',
        default: false,
        describe:
          "Set to `true` if you don't want to generate a package.json file in the bundle output.",
      })
      .option('cjsOutDir', {
        default: '.',
        type: 'string',
        description: 'The directory to output the cjs files to.',
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging.',
      })
      .option('buildTypes', {
        type: 'boolean',
        default: true,
        description: 'Whether to build types for the package.',
      })
      .option('skipTsc', {
        type: 'boolean',
        default: false,
        description: 'Skip running TypeScript compiler (tsc) for building types.',
      })
      .option('ignore', {
        type: 'string',
        array: true,
        description: 'Extra globs to be ignored by Babel.',
        default: [],
      })
      .option('skipBabelRuntimeCheck', {
        type: 'boolean',
        default: false,
        description: 'Skip checking for Babel runtime dependencies in the package.',
      })
      .option('skipPackageJson', {
        type: 'boolean',
        default: false,
        description: 'Skip generating the package.json file in the bundle output.',
      })
      .option('watch', {
        type: 'boolean',
        default: false,
        description: 'Watch files for changes and rebuild automatically.',
      });
  },
  async handler({ bundler, ...args }) {
    let pkgName = '';
    await markFn('build-new', async () => {
      const cwd = process.cwd();
      const pkgJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));

      if (!bundler) {
        throw new Error('No bundler specified');
      }
      pkgName = pkgJson.name;
      console.log(`⚒️ Building ${pkgJson.name} with 📦 "${bundler}"`);
      validatePkgJson(pkgJson);

      switch (bundler) {
        case 'rslib':
          await import('../bundlers/rslib.mjs').then(({ build }) => build(args, pkgJson));
          break;
        case 'tsdown':
        default:
          await import('../bundlers/tsdown.mjs').then(({ build }) => build(args, pkgJson));
          break;
      }
    });
    console.log(
      `✅ Built "${pkgName}" in ${(measureFn('build-new').duration / 1000).toFixed(3)}s.`,
    );
  },
});

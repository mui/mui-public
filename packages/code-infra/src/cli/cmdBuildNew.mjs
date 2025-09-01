/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { markFn, measureFn, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {Omit<import('./cmdBuild.mjs').Args, 'hasLargeFiles' | 'skipBundlePackageJson' | 'skipMainCheck' | 'cjsOutDir' | 'skipBabelRuntimeCheck' | 'skipTsc' | 'buildTypes'> & {sourceMap?: boolean; skipTypes?: boolean}} BaseArgs
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
const validBundlers = ['tsdown'];

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Builds the package for publishing.',
  builder: (yargs) =>
    yargs
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
      .option('skipPackageJson', {
        type: 'boolean',
        default: false,
        description: 'Skip generating the package.json file in the bundle output.',
      }),
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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

import { BASE_IGNORES, getOutExtension, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 */

const SOURCE_DIR = 'src';
const SOURCE_GLOB = `${SOURCE_DIR}/**/*.{js,ts,tsx}`;

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Experimental tsdown build. Compiles JavaScript only.',
  builder: (yargs) =>
    yargs.option('bundle', {
      array: true,
      type: 'string',
      choices: /** @type {const} */ (['esm', 'cjs']),
      default: /** @type {import('../utils/build.mjs').BundleType[]} */ (['esm', 'cjs']),
      description: 'Bundles to output.',
    }),
  async handler(args) {
    const cwd = process.cwd();
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    validatePkgJson(packageJson);

    const outDir = path.join(cwd, packageJson.publishConfig.directory);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';
    const entry = await globby(SOURCE_GLOB, { cwd, ignore: BASE_IGNORES });

    const { build } = await import('tsdown');
    await build({
      cwd,
      config: false,
      entry,
      unbundle: true,
      root: SOURCE_DIR,
      outDir,
      clean: true,
      format: [...new Set(args.bundle)].map((bundle) => FORMATS[bundle]),
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      outputOptions: { exports: 'named' },
      dts: false,
      exports: false,
      report: false,
      logLevel: 'warn',
    });
  },
});

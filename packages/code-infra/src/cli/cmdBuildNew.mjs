import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getOutExtension, getPackageSources, validatePkgJson } from '../utils/build.mjs';
import { fileUrlEntriesPlugin } from '../utils/fileUrlEntriesPlugin.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 */

const SOURCE_DIR = 'src';
// Importers keep `#` specifiers, so consumers resolve the `imports` conditions.
const PACKAGE_IMPORTS = /^#/;
const MODULE_LEVEL_DIRECTIVE = 'MODULE_LEVEL_DIRECTIVE';

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

/**
 * Resolves the source modules behind the package's published paths, keyed by output name.
 * @param {import('./packageJson').PackageJson} packageJson
 * @param {string} cwd
 * @returns {Promise<Record<string, string>>}
 */
async function getEntry(packageJson, cwd) {
  const sources = await getPackageSources(packageJson, cwd);

  return Object.fromEntries(
    sources.map((source) => {
      const name = path.relative(SOURCE_DIR, source);

      return [name.slice(0, -path.extname(name).length), source];
    }),
  );
}

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
    const entry = await getEntry(packageJson, cwd);

    const { build } = await import('tsdown');
    await build({
      cwd,
      config: false,
      entry,
      unbundle: true,
      platform: 'neutral',
      root: SOURCE_DIR,
      outDir,
      clean: true,
      format: [...new Set(args.bundle)].map((bundle) => FORMATS[bundle]),
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      plugins: [fileUrlEntriesPlugin()],
      inputOptions: {
        external: [PACKAGE_IMPORTS],
        // tsdown otherwise takes `jsx` from the package's tsconfig, which may preserve JSX.
        transform: { jsx: { runtime: 'automatic' } },
      },
      outputOptions: { exports: 'named' },
      dts: false,
      exports: false,
      report: false,
      logLevel: 'warn',
      // Unbundled output keeps each module's directives; the warning is about bundling.
      suppressWarnings: [MODULE_LEVEL_DIRECTIVE],
    });
  },
});

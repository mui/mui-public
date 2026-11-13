import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createPackageBin,
  createPackageExports,
  createPackageImports,
  getOutExtension,
  validatePkgJson,
} from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 */

const SOURCE_DIR = 'src';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function getLeaves(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.values(value).flatMap(getLeaves);
}

/**
 * Resolves the source modules behind the ESM paths `code-infra build` would publish.
 * @param {import('./packageJson').PackageJson} packageJson
 * @param {{ cwd: string; outDir: string; packageType: 'module' | 'commonjs' }} options
 * @returns {Promise<Record<string, string>>}
 */
async function getEntry(packageJson, { cwd, outDir, packageType }) {
  /** @type {import('../utils/build.mjs').BundleType[]} */
  const bundles = ['esm'];
  const [{ exports }, imports, bin] = await Promise.all([
    createPackageExports(packageJson.exports, { bundles, cwd, outputDir: outDir, packageType }),
    createPackageImports(packageJson.imports, { bundles, cwd, packageType }),
    createPackageBin(packageJson.bin, { bundles, cwd, packageType }),
  ]);

  const extension = getOutExtension('esm', { packageType });
  const names = new Set(
    getLeaves([exports, imports, bin])
      .filter((leaf) => leaf.startsWith('./') && leaf.endsWith(extension))
      .map((leaf) => leaf.slice('./'.length, -extension.length)),
  );

  const entries = await Promise.all(
    [...names].map(async (name) => {
      const candidates = SOURCE_EXTENSIONS.map((ext) => path.join(SOURCE_DIR, `${name}${ext}`));
      const found = await Promise.all(
        candidates.map((file) =>
          fs.stat(path.join(cwd, file)).then(
            (stats) => stats.isFile(),
            () => false,
          ),
        ),
      );
      const source = candidates.find((_, index) => found[index]);
      return source ? [[name, source]] : [];
    }),
  );
  return Object.fromEntries(entries.flat());
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
    const entry = await getEntry(packageJson, { cwd, outDir, packageType });

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

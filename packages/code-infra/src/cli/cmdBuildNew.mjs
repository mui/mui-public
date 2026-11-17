import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createPackageBin,
  createPackageExports,
  createPackageImports,
  getOutExtension,
  validatePkgJson,
} from '../utils/build.mjs';
import { fileUrlEntriesPlugin } from '../utils/fileUrlEntriesPlugin.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 */

const SOURCE_DIR = 'src';
// Importers keep `#` specifiers, so consumers resolve the `imports` conditions.
const PACKAGE_IMPORTS = /^#/;
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
 * @param {string} leaf
 * @returns {string | null}
 */
function toSource(leaf) {
  const rel = leaf.replace(/^\.\//, '');
  if (!rel.startsWith(`${SOURCE_DIR}/`) || !SOURCE_EXTENSIONS.includes(path.extname(rel))) {
    return null;
  }
  return rel.slice(SOURCE_DIR.length + 1);
}

/**
 * The source paths relative to `src/` that `map` declares, with the key declaring each.
 * @param {unknown} map - `exports`, `imports` or `bin`.
 * @returns {{ key: string; source: string }[]}
 */
function getDeclarations(map) {
  const entries = typeof map === 'string' ? [['.', map]] : Object.entries(map ?? {});
  return entries.flatMap(([key, value]) =>
    getLeaves(value).flatMap((leaf) => {
      const source = toSource(leaf);
      return source ? [{ key, source }] : [];
    }),
  );
}

/**
 * Orders keys as Node picks them: exact keys first, then the longest prefix before `*`, then the
 * longest suffix.
 * @param {{ key: string }} a
 * @param {{ key: string }} b
 */
function compareSpecificity(a, b) {
  const [prefixA, suffixA] = getSpecificity(a.key);
  const [prefixB, suffixB] = getSpecificity(b.key);
  if (prefixA !== prefixB) {
    return prefixB - prefixA;
  }
  return suffixB - suffixA;
}

/** @param {string} key */
function getSpecificity(key) {
  const star = key.indexOf('*');
  return star === -1 ? [Infinity, 0] : [star, key.length - star - 1];
}

/**
 * @param {string} name
 * @param {string} source - A declared source path relative to `src/`, possibly with a `*`.
 * @returns {boolean}
 */
function matchesSource(name, source) {
  const stem = source.slice(0, -path.extname(source).length);
  const star = stem.indexOf('*');
  if (star === -1) {
    return stem === name;
  }

  const prefix = stem.slice(0, star);
  const suffix = stem.slice(star + 1);
  return (
    name.length > prefix.length + suffix.length && name.startsWith(prefix) && name.endsWith(suffix)
  );
}

/**
 * Resolves the source modules behind the package's published ESM paths.
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

  const declarations = [packageJson.exports, packageJson.imports, packageJson.bin]
    .flatMap(getDeclarations)
    .sort(compareSpecificity);

  const entries = await Promise.all(
    [...names].map(async (name) => {
      const candidates = declarations
        .filter(({ source }) => matchesSource(name, source))
        .map(({ source }) => path.join(SOURCE_DIR, `${name}${path.extname(source)}`));
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
      inputOptions: { external: [PACKAGE_IMPORTS] },
      outputOptions: { exports: 'named' },
      dts: false,
      exports: false,
      report: false,
      logLevel: 'warn',
    });
  },
});

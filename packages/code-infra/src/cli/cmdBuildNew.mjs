import getTargets from '@babel/helper-compilation-targets';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isDynamicPattern } from 'globby';

import {
  createPackageBin,
  createPackageExports,
  createPackageImports,
  getOutExtension,
  validatePkgJson,
} from '../utils/build.mjs';
import { getVersionEnvVariables } from '../utils/babel.mjs';
import { babelPlugin } from '../utils/babelPlugin.mjs';
import { getPublishedPkgJson } from '../utils/getPublishedPkgJson.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 * @property {string[]} copy
 */

const SOURCE_DIR = 'src';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

/** @type {Record<import('../utils/build.mjs').BundleType, string>} */
const BROWSERSLIST_ENVS = { esm: 'stable', cjs: 'node' };

const OXC_ENGINES = new Set([
  'chrome',
  'deno',
  'edge',
  'firefox',
  'hermes',
  'ie',
  'ios',
  'node',
  'opera',
  'rhino',
  'safari',
  'samsung',
]);

/**
 * @param {string} cwd
 * @param {import('../utils/build.mjs').BundleType} bundle
 * @returns {string[]} Oxc targets for the bundle's browserslist environment.
 */
function getTarget(cwd, bundle) {
  const targets = getTargets(undefined, {
    configPath: cwd,
    browserslistEnv: BROWSERSLIST_ENVS[bundle],
  });
  return Object.entries(targets)
    .filter(([engine]) => OXC_ENGINES.has(engine))
    .map(([engine, version]) => `${engine}${version}`);
}

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
 * @param {{ cwd: string; packageType: 'module' | 'commonjs' }} options
 * @returns {Promise<Record<string, string>>}
 */
async function getEntry(packageJson, { cwd, packageType }) {
  /** @type {import('../utils/build.mjs').BundleType[]} */
  const bundles = ['esm'];
  const [{ exports }, imports, bin] = await Promise.all([
    createPackageExports(packageJson.exports, { bundles, cwd, outputDir: cwd, packageType }),
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

const DOCUMENTS = ['README.md', 'LICENSE', 'CHANGELOG.md'];

/** @param {string} file */
function exists(file) {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * Matches `code-infra build`: package documents fall back to the workspace root, `source:target`
 * globs drop the first source directory, and missing literal paths are skipped.
 * @param {string} cwd
 * @param {string} outDir
 * @param {string[]} globs
 * @returns {Promise<import('tsdown').UserConfig['copy']>}
 */
async function getCopy(cwd, outDir, globs) {
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }

  const documents = await Promise.all(
    DOCUMENTS.map(async (name) => {
      const local = path.join(cwd, name);
      if (await exists(local)) {
        return [{ from: local, to: outDir }];
      }
      const root = path.join(workspaceDir, name);
      return (await exists(root)) ? [{ from: root, to: outDir }] : [];
    }),
  );

  const extras = await Promise.all(
    globs.map(async (glob) => {
      const [from, target = ''] = glob.split(':');
      if (!isDynamicPattern(from) && !(await exists(path.resolve(cwd, from)))) {
        return [];
      }
      return [{ from, to: path.join(outDir, target), flatten: false }];
    }),
  );

  return [...documents, ...extras].flat();
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Experimental tsdown build. Compiles JavaScript, copies files and writes package.json.',
  builder: (yargs) =>
    yargs
      .option('bundle', {
        array: true,
        type: 'string',
        choices: /** @type {const} */ (['esm', 'cjs']),
        default: /** @type {import('../utils/build.mjs').BundleType[]} */ (['esm', 'cjs']),
        description: 'Bundles to output.',
      })
      .option('copy', {
        array: true,
        type: 'string',
        default: /** @type {string[]} */ ([]),
        description: 'Files to copy to the output directory, as `glob` or `glob:target`.',
      }),
  async handler(args) {
    const cwd = process.cwd();
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    validatePkgJson(packageJson);

    const outDir = path.join(cwd, packageJson.publishConfig.directory);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';
    const bundles = [...new Set(args.bundle)];
    const entry = await getEntry(packageJson, { cwd, packageType });

    const { build } = await import('tsdown');
    await build({
      cwd,
      config: false,
      entry,
      unbundle: true,
      root: SOURCE_DIR,
      outDir,
      clean: true,
      format: Object.fromEntries(
        bundles.map((bundle) => [FORMATS[bundle], { target: getTarget(cwd, bundle) }]),
      ),
      define: Object.fromEntries(
        Object.entries(getVersionEnvVariables(packageJson.version)).map(([name, value]) => [
          `process.env.${name}`,
          value === undefined ? 'undefined' : JSON.stringify(value),
        ]),
      ),
      plugins: [babelPlugin(packageJson)],
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      outputOptions: { exports: 'named' },
      dts: false,
      exports: false,
      report: false,
      copy: await getCopy(cwd, outDir, args.copy),
      logLevel: 'warn',
    });

    const publishedPkgJson = await getPublishedPkgJson({
      packageJson,
      bundles,
      outputDir: outDir,
      cwd,
      addTypes: false,
      packageType,
    });
    await fs.writeFile(
      path.join(outDir, 'package.json'),
      JSON.stringify(publishedPkgJson, null, 2),
      'utf-8',
    );
  },
});

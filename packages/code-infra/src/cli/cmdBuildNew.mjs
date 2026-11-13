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
import { dtsExportsPlugin } from '../utils/dtsExportsPlugin.mjs';
import { getPublishedPkgJson } from '../utils/getPublishedPkgJson.mjs';
import { validateWithPublint } from '../utils/publint.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 * @property {string[]} copy
 * @property {boolean} buildTypes
 * @property {boolean} skipPublint
 */

const SOURCE_DIR = 'src';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

const BABEL_CONFIG_FILES = ['babel.config.js', 'babel.config.mjs'];

/** @type {Record<import('../utils/build.mjs').BundleType, string>} */
const BROWSERSLIST_ENVS = { esm: 'stable', cjs: 'node' };

// Oxc exports no compat table and accepts some engines it then ignores (android, ie, hermes,
// rhino), so this lists the Babel target engines Oxc was verified to lower for.
const OXC_ENGINES = new Set([
  'chrome',
  'edge',
  'electron',
  'firefox',
  'ios',
  'node',
  'opera',
  'safari',
  'samsung',
]);

/**
 * Resolves the bundle's browserslist environment the way `@babel/preset-env` does for
 * `code-infra build`. Oxc can't lower for every engine Babel knows, so those fail instead of
 * silently shipping less-compiled code.
 * @param {string} cwd
 * @param {import('../utils/build.mjs').BundleType} bundle
 * @returns {string[]} Oxc targets.
 */
function getTarget(cwd, bundle) {
  const env = BROWSERSLIST_ENVS[bundle];
  const targets = Object.entries(getTargets({}, { configPath: cwd, browserslistEnv: env }));
  if (targets.length === 0) {
    throw new Error(`No browserslist targets found for the "${env}" environment.`);
  }

  const unsupported = targets.filter(([engine]) => !OXC_ENGINES.has(engine));
  if (unsupported.length > 0) {
    const engines = unsupported.map(([engine]) => engine).join(', ');
    throw new Error(`Oxc cannot target ${engines} from the "${env}" browserslist environment.`);
  }

  return targets.map(([engine, version]) => `${engine}${version}`);
}

/**
 * The workspace Babel config `code-infra build` uses, or the base config without one.
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function getBabelConfigFile(cwd) {
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }
  for (const name of BABEL_CONFIG_FILES) {
    const file = path.join(workspaceDir, name);
    // eslint-disable-next-line no-await-in-loop
    if (await exists(file)) {
      return file;
    }
  }
  return path.join(import.meta.dirname, '../babel-config.mjs');
}

/**
 * @param {string} cwd
 * @returns {Promise<string>} The `tsconfig.build.json` `code-infra build` emits declarations with.
 */
async function getTsconfig(cwd) {
  const tsconfig = path.join(cwd, 'tsconfig.build.json');
  if (!(await exists(tsconfig))) {
    throw new Error(
      `Unable to find a tsconfig to build types. Add 'tsconfig.build.json' to '${cwd}'.`,
    );
  }
  return tsconfig;
}

/**
 * @param {string} cwd
 * @returns {Promise<string>} The workspace TypeScript 7 `tsc`, which rolldown-plugin-dts runs as `tsgo`.
 */
async function getTsc(cwd) {
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }
  return path.join(workspaceDir, 'node_modules', '.bin', 'tsc');
}

/**
 * The environment `code-infra build` gives Babel; workspace configs branch on it.
 * @param {import('./packageJson').PackageJson} packageJson
 * @param {import('../utils/build.mjs').BundleType[]} bundles
 * @returns {Record<string, string>}
 */
function getBabelEnv(packageJson, bundles) {
  const dependencies = packageJson.dependencies ?? {};
  /** @type {Record<string, string>} */
  const env = {
    NODE_ENV: 'production',
    // One Babel pass serves every format, so configs see the first bundle's environment.
    BABEL_ENV: BROWSERSLIST_ENVS[bundles[0]],
  };
  if (dependencies['prop-types'] !== undefined) {
    env.MUI_REMOVE_PROP_TYPES = 'true';
  }
  if (dependencies.clsx !== undefined || dependencies.classnames !== undefined) {
    env.MUI_OPTIMIZE_CLSX = 'true';
  }
  return env;
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
      })
      .option('buildTypes', {
        type: 'boolean',
        default: true,
        description: 'Whether to write declarations with the workspace TypeScript 7 `tsc`.',
      })
      .option('skipPublint', {
        type: 'boolean',
        default: false,
        description: 'Skip validating the output directory with publint.',
      }),
  async handler(args) {
    const cwd = process.cwd();
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    validatePkgJson(packageJson);

    const outDir = path.join(cwd, packageJson.publishConfig.directory);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';
    const bundles = [...new Set(args.bundle)];
    const entry = await getEntry(packageJson, { cwd, packageType });

    const versionEnv = getVersionEnvVariables(packageJson.version);
    Object.assign(process.env, getBabelEnv(packageJson, bundles));
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
      env: { ...versionEnv, MUI_PRERELEASE: versionEnv.MUI_PRERELEASE ?? null },
      envPrefix: [],
      // `code-infra build` compiles JSX in `.js` files too.
      loader: { '.js': 'jsx' },
      plugins: [babelPlugin(await getBabelConfigFile(cwd))],
      // tsdown leaves `plugins` out of its CJS declaration pass; `inputOptions` reaches every pass.
      inputOptions: (options) => ({ ...options, plugins: [dtsExportsPlugin(), options.plugins] }),
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      outputOptions: { exports: 'named' },
      tsconfig: args.buildTypes ? await getTsconfig(cwd) : undefined,
      // Keeps CJS declarations on `export default`, matching the named-exports JS interop.
      cjsDefault: false,
      // TODO: tsdown >=0.23.5 (rolldown-plugin-dts >=0.29) runs TS7 through its API, which needs
      // TypeScript 7.1. Once it's stable, bump and replace `tsgo.path` with `tsgo.moduleUrl`.
      dts: args.buildTypes
        ? { generator: 'tsgo', tsgo: { path: await getTsc(cwd) }, sourcemap: false }
        : false,
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
      addTypes: args.buildTypes,
      packageType,
    });
    await fs.writeFile(
      path.join(outDir, 'package.json'),
      JSON.stringify(publishedPkgJson, null, 2),
      'utf-8',
    );

    if (!args.skipPublint) {
      await validateWithPublint(outDir);
    }
  },
});

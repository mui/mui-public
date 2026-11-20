import getTargets from '@babel/helper-compilation-targets';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { globby } from 'globby';
import * as semver from 'semver';

import { getOutExtension, getPackageSources, validatePkgJson } from '../utils/build.mjs';
import { getVersionEnvVariables } from '../utils/babel.mjs';
import { babelPlugin } from '../utils/babelPlugin.mjs';
import { dtsExportsPlugin } from '../utils/dtsExportsPlugin.mjs';
import { fileUrlEntriesPlugin } from '../utils/fileUrlEntriesPlugin.mjs';
import { getPublishedPkgJson } from '../utils/getPublishedPkgJson.mjs';
import { readPnpmConfig } from '../utils/pnpm.mjs';
import { getTsconfig } from '../utils/typescript.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 * @property {string[]} copy
 * @property {boolean} buildTypes
 * @property {boolean} enableReactCompiler
 */

const SOURCE_DIR = 'src';
// Importers keep `#` specifiers, so consumers resolve the `imports` conditions.
const PACKAGE_IMPORTS = /^#/;
const MODULE_LEVEL_DIRECTIVE = 'MODULE_LEVEL_DIRECTIVE';

/** @type {Record<import('../utils/build.mjs').BundleType, 'es' | 'cjs'>} */
const FORMATS = { esm: 'es', cjs: 'cjs' };

const BABEL_CONFIG_FILES = ['babel.config.js', 'babel.config.mjs'];

const TYPESCRIPT = 'typescript';

const BABEL_RUNTIME = '@babel/runtime';

const OXC_HELPERS = '@oxc-project/runtime/helpers/';
// Oxc's legacy decorator helpers have no `@babel/runtime` equivalent, so Rolldown bundles them.
const OXC_SHARED_HELPERS = /^@oxc-project\/runtime\/helpers\/(?!decorate)/;

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
 * Resolves the bundle's browserslist environment the way `@babel/preset-env` does. Oxc can't lower
 * for every engine Babel knows, so those fail instead of silently shipping less-compiled code.
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
 * The workspace Babel config, or the base config without one.
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
 * @returns {Promise<string>} The native binary of the workspace's TypeScript 7, which
 * rolldown-plugin-dts runs as `tsgo`.
 */
async function getTsc(cwd) {
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }
  const manifest = path.join(workspaceDir, 'package.json');
  const { dependencies, devDependencies } = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const require = createRequire(manifest);
  const candidates = await Promise.all(
    Object.entries({ ...dependencies, ...devDependencies })
      .filter(([name, spec]) => name === TYPESCRIPT || spec.startsWith(`npm:${TYPESCRIPT}@`))
      .map(async ([name]) => {
        const file = require.resolve(`${name}/package.json`);
        const { version } = JSON.parse(await fs.readFile(file, 'utf8'));
        return { dir: path.dirname(file), version };
      }),
  );
  const native = candidates.find(({ version }) => semver.major(version) >= 7);
  if (!native) {
    throw new Error(
      'Install TypeScript 7 at the workspace root, as "typescript@^7" or under an alias such as "@typescript/native", to build types.',
    );
  }
  // `node_modules/.bin/tsc` is a shell script on Windows, which rolldown-plugin-dts can't spawn.
  const { default: getExePath } = await import(
    pathToFileURL(path.join(native.dir, 'lib/getExePath.js')).href
  );
  return getExePath();
}

/**
 * @param {import('./packageJson').PackageJson} packageJson
 * @returns {Promise<string | undefined>} The `@babel/runtime` range the package depends on.
 */
async function getBabelRuntime(packageJson) {
  const version = packageJson.dependencies?.[BABEL_RUNTIME];
  if (version !== 'catalog:') {
    return version;
  }
  const config = await readPnpmConfig();
  return config.catalog[BABEL_RUNTIME];
}

/**
 * The environment Babel runs in; workspace configs branch on it.
 * @param {import('./packageJson').PackageJson} packageJson
 * @param {{ bundles: import('../utils/build.mjs').BundleType[]; babelRuntime: string | undefined; reactCompiler: 'on' | 'off' }} options
 * @returns {Record<string, string>}
 */
function getBabelEnv(packageJson, { bundles, babelRuntime, reactCompiler }) {
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
  if (babelRuntime) {
    env.MUI_BABEL_RUNTIME_VERSION = babelRuntime;
  }
  if (reactCompiler === 'on') {
    env.MUI_REACT_COMPILER = '1';
    env.MUI_REACT_COMPILER_REACT_VERSION =
      semver.minVersion(packageJson.peerDependencies?.react ?? '')?.version ?? 'latest';
  }
  return env;
}

/**
 * Fails the build when the output imports Babel helpers the package doesn't depend on.
 * @param {string | undefined} babelRuntime
 * @returns {import('tsdown').Rolldown.Plugin}
 */
function babelRuntimePlugin(babelRuntime) {
  return {
    name: 'code-infra:babel-runtime',
    generateBundle(_options, bundle) {
      if (babelRuntime) {
        return;
      }
      const chunk = Object.values(bundle).find(
        (output) =>
          output.type === 'chunk' &&
          output.imports.some(
            (id) => id.startsWith(`${BABEL_RUNTIME}/`) || id.startsWith(OXC_HELPERS),
          ),
      );
      if (!chunk) {
        return;
      }
      this.error(
        `${chunk.fileName} imports Babel helpers, so package.json needs a dependency on \`${BABEL_RUNTIME}\`.`,
      );
    },
  };
}

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

const DOCUMENTS = ['README.md', 'LICENSE', 'CHANGELOG.md'];

/** @param {string} file */
function exists(file) {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * Package documents fall back to the workspace root, `source:target` globs expand directories and
 * drop the first source directory, and missing paths are skipped.
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

  const documents = Promise.all(
    DOCUMENTS.map(async (name) => {
      const local = path.join(cwd, name);
      if (await exists(local)) {
        return [{ from: local, to: outDir }];
      }
      const root = path.join(workspaceDir, name);
      return (await exists(root)) ? [{ from: root, to: outDir }] : [];
    }),
  );

  const extras = Promise.all(
    globs.map(async (glob) => {
      const [pattern, target = ''] = glob.split(':');
      const from = await globby(pattern, { cwd });
      if (!from.length) {
        return [];
      }
      return [{ from, to: path.join(outDir, target), flatten: false }];
    }),
  );

  return (await Promise.all([documents, extras])).flat(2);
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
      .option('enableReactCompiler', {
        type: 'boolean',
        default: false,
        description: 'Compile components with the React compiler.',
      }),
  async handler(args) {
    const cwd = process.cwd();
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    validatePkgJson(packageJson, { enableReactCompiler: args.enableReactCompiler });

    const outDir = path.join(cwd, packageJson.publishConfig.directory);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';
    const bundles = [...new Set(args.bundle)];

    const [entry, copy, babelRuntime, babelConfigFile, tsconfig, tsc, { build }] =
      await Promise.all([
        getEntry(packageJson, cwd),
        getCopy(cwd, outDir, args.copy),
        getBabelRuntime(packageJson),
        getBabelConfigFile(cwd),
        args.buildTypes ? getTsconfig(cwd) : undefined,
        args.buildTypes ? getTsc(cwd) : undefined,
        import('tsdown'),
      ]);

    const { MUI_PRERELEASE: prerelease, ...versionEnv } = getVersionEnvVariables(
      packageJson.version,
    );
    const reactCompiler = args.enableReactCompiler ? 'on' : 'off';
    Object.assign(process.env, getBabelEnv(packageJson, { bundles, babelRuntime, reactCompiler }));
    await build({
      cwd,
      config: false,
      entry,
      unbundle: true,
      platform: 'neutral',
      root: SOURCE_DIR,
      outDir,
      clean: true,
      format: Object.fromEntries(
        bundles.map((bundle) => [FORMATS[bundle], { target: getTarget(cwd, bundle) }]),
      ),
      env: versionEnv,
      // `env` values go through JSON, which can't hold the `undefined` of a stable version.
      define: {
        'process.env.MUI_PRERELEASE':
          prerelease === undefined ? 'undefined' : JSON.stringify(prerelease),
      },
      envPrefix: [],
      // `.js` sources may contain JSX.
      loader: { '.js': 'jsx' },
      plugins: [
        fileUrlEntriesPlugin(),
        babelPlugin(babelConfigFile),
        babelRuntimePlugin(babelRuntime),
      ],
      // tsdown leaves `plugins` out of its CJS declaration pass; `inputOptions` reaches every pass.
      inputOptions: (options) => ({
        ...options,
        // tsdown otherwise takes `jsx` from the package's tsconfig, which may preserve JSX.
        transform: { ...options.transform, jsx: { runtime: 'automatic' } },
        plugins: [dtsExportsPlugin(), options.plugins],
        external: [PACKAGE_IMPORTS, OXC_SHARED_HELPERS],
      }),
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      outputOptions: {
        exports: 'named',
        // Returning the id itself would print relative externals unresolved; `undefined` keeps
        // Rolldown's own path for them.
        paths: /** @type {(id: string) => string} */ (
          (id) =>
            id.startsWith(OXC_HELPERS)
              ? `${BABEL_RUNTIME}/helpers/${id.slice(OXC_HELPERS.length)}`
              : undefined
        ),
      },
      tsconfig,
      // Keeps CJS declarations on `export default`, matching the named-exports JS interop.
      cjsDefault: false,
      // TODO: tsdown >=0.23.5 (rolldown-plugin-dts >=0.29) runs TS7 through its API, which needs
      // TypeScript 7.1. Once it's stable, bump and replace `tsgo.path` with `tsgo.moduleUrl`.
      dts: args.buildTypes ? { generator: 'tsgo', tsgo: { path: tsc }, sourcemap: false } : false,
      exports: false,
      report: false,
      copy,
      logLevel: 'warn',
      // Unbundled output keeps each module's directives; the warning is about bundling.
      suppressWarnings: [MODULE_LEVEL_DIRECTIVE],
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
  },
});

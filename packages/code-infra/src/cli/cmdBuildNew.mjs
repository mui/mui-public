import { transformAsync } from '@babel/core';
import getTargets from '@babel/helper-compilation-targets';
import pluginReactPureAnnotations from '@babel/plugin-transform-react-pure-annotations';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

import { getOutExtension, getPackageSources, validatePkgJson } from '../utils/build.mjs';
import { getVersionEnvVariables } from '../utils/babel.mjs';
import { fileUrlEntriesPlugin } from '../utils/fileUrlEntriesPlugin.mjs';
import { getPublishedPkgJson } from '../utils/getPublishedPkgJson.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle
 * @property {string[]} copy
 */

const SOURCE_DIR = 'src';
// Importers keep `#` specifiers, so consumers resolve the `imports` conditions.
const PACKAGE_IMPORTS = /^#/;
const MODULE_LEVEL_DIRECTIVE = 'MODULE_LEVEL_DIRECTIVE';

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

const BABEL_FILES = /\.[cm]?[jt]sx?$/;
const TS_FILES = /\.[cm]?tsx?$/;
const TS_WITHOUT_JSX = /\.[cm]?ts$/;

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
 * Runs the MUI Babel plugins that have no Oxc equivalent. Oxc then strips types, compiles JSX
 * and lowers syntax.
 * @param {import('./packageJson').PackageJson} packageJson
 * @returns {import('tsdown').Rolldown.Plugin}
 */
function babelPlugin(packageJson) {
  const dependencies = packageJson.dependencies ?? {};
  /** @type {import('@babel/core').PluginItem[]} */
  const plugins = [pluginDisplayName];
  if (dependencies['prop-types'] !== undefined) {
    plugins.push([pluginRemovePropTypes, { mode: 'unsafe-wrap' }]);
  }
  if (dependencies.clsx !== undefined || dependencies.classnames !== undefined) {
    plugins.push(pluginOptimizeClsx);
  }
  // Oxc only marks JSX as pure, not React calls such as `createContext()`.
  plugins.push(pluginReactPureAnnotations);

  return {
    name: 'code-infra:babel',
    transform: {
      filter: { id: { include: BABEL_FILES, exclude: /node_modules/ } },
      async handler(code, id) {
        /** @type {NonNullable<import('@babel/core').InputOptions['parserOpts']>['plugins']} */
        const syntax = [];
        if (TS_FILES.test(id)) {
          syntax.push('typescript');
        }
        if (!TS_WITHOUT_JSX.test(id)) {
          syntax.push('jsx');
        }
        const result = await transformAsync(code, {
          filename: id,
          configFile: false,
          babelrc: false,
          sourceMaps: true,
          parserOpts: { plugins: syntax },
          plugins,
        });
        if (!result?.code) {
          return null;
        }
        return {
          code: result.code,
          map: /** @type {import('tsdown').Rolldown.SourceMapInput} */ (result.map),
        };
      },
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
      }),
  async handler(args) {
    const cwd = process.cwd();
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    validatePkgJson(packageJson);

    const outDir = path.join(cwd, packageJson.publishConfig.directory);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';
    const bundles = [...new Set(args.bundle)];

    const [entry, copy, { build }] = await Promise.all([
      getEntry(packageJson, cwd),
      getCopy(cwd, outDir, args.copy),
      import('tsdown'),
    ]);

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
      define: Object.fromEntries(
        Object.entries(getVersionEnvVariables(packageJson.version)).map(([name, value]) => [
          `process.env.${name}`,
          value === undefined ? 'undefined' : JSON.stringify(value),
        ]),
      ),
      plugins: [fileUrlEntriesPlugin(), babelPlugin(packageJson)],
      outExtensions: ({ format }) => ({
        js: getOutExtension(format === 'es' ? 'esm' : 'cjs', { packageType }),
      }),
      deps: { neverBundle: true },
      inputOptions: {
        external: [PACKAGE_IMPORTS],
        // tsdown otherwise takes `jsx` from the package's tsconfig, which may preserve JSX.
        transform: { jsx: { runtime: 'automatic' } },
      },
      outputOptions: { exports: 'named' },
      dts: false,
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

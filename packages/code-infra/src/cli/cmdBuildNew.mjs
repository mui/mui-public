import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

import { getOutExtension, getPackageSources, validatePkgJson } from '../utils/build.mjs';
import { fileUrlEntriesPlugin } from '../utils/fileUrlEntriesPlugin.mjs';

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
      const [pattern, target = ''] = glob.split(':');
      const from = await globby(pattern, { cwd });
      if (!from.length) {
        return [];
      }
      return [{ from, to: path.join(outDir, target), flatten: false }];
    }),
  );

  return [...documents, ...extras].flat();
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build-new',
  describe: 'Experimental tsdown build. Compiles JavaScript and copies files.',
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
      copy: await getCopy(cwd, outDir, args.copy),
      logLevel: 'warn',
      // Unbundled output keeps each module's directives; the warning is about bundling.
      suppressWarnings: [MODULE_LEVEL_DIRECTIVE],
    });
  },
});

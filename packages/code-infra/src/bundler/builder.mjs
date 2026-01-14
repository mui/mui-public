import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveBinEntries, resolveExportsEntries } from './utils/resolve-entrypoints.mjs';
import { findBabelConfigRoot, findTsConfig } from './utils/config-finder.mjs';
import { createBundlerAdapter } from './adapters/index.mjs';
import { generateExportsField } from './utils/generate-exports-field.mjs';

/**
 * @typedef {import('./types.mjs').BundlerConfig} BundlerConfig
 * @typedef {import('./types.mjs').BundlerType} BundlerType
 * @typedef {import('./types.mjs').PackageInfo} PackageInfo
 * @typedef {import('./types.mjs').ResolvedEntry} ResolvedEntry
 * @typedef {import('./types.mjs').GeneratedExports} GeneratedExports
 */

/**
 * @typedef {'esm' | 'cjs' | 'both'} BundleFormat
 */

/**
 * @typedef {Object} CLIOptions
 * @property {BundlerType} bundler - The bundler to use
 * @property {string} outDir - Output directory
 * @property {BundleFormat} format - Bundle format (esm, cjs, or both)
 * @property {boolean} [watch] - Enable watch mode
 * @property {boolean} [sourceMap] - Generate source maps
 * @property {string} [cwd] - Working directory (defaults to cwd)
 * @property {string} [tsconfigPath] - TypeScript config path if exists
 * @property {string} [babelConfigPath] - Babel config path if exists
 * @property {boolean} [bundleCss] - Should bundle css
 * @property {boolean} [verbose]
 * @property {boolean} [preserveDirectory]
 * @property {boolean} [enableReactCompiler]
 * @property {boolean} [clean]
 */

/**
 * @param {string} cwd
 * @returns {Promise<PackageInfo>}
 */
export async function parsePackageJson(cwd) {
  const packageJsonPath = path.join(cwd, 'package.json');
  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  return {
    name: pkg.name || 'unknown',
    version: pkg.version || '0.0.0',
    license: pkg.license,
    exports: pkg.exports,
    bin: pkg.bin,
    dependencies: pkg.dependencies,
    peerDependencies: pkg.peerDependencies,
    peerDependenciesMeta: pkg.peerDependenciesMeta,
    type: pkg.type || 'commonjs',
    sideEffects: pkg.sideEffects,
  };
}

/**
 * @param {CLIOptions} options
 * @returns {Promise<GeneratedExports>}
 */
export async function build(options) {
  const cwd = options.cwd || process.cwd();
  const packageInfo = await parsePackageJson(cwd);

  const exportEntries = await resolveExportsEntries(packageInfo.exports, cwd);
  const binEntries = await resolveBinEntries(packageInfo.bin, cwd);

  if (exportEntries.length === 0 && binEntries.length === 0) {
    throw new Error(
      'No entry points found in package.json exports or bin fields. Please add an "exports" or "bin" field to your package.json.',
    );
  }

  const tsconfigPath = await findTsConfig(cwd);
  const babelConfigPath = await findBabelConfigRoot(cwd);
  /** @type {('esm' | 'cjs')[]} */
  const formats = options.format === 'both' ? ['esm', 'cjs'] : [options.format];

  /** @type {Map<string, ResolvedEntry>} */
  const entries = new Map(
    Array.from([...exportEntries, ...binEntries]).map((entry) => [entry.exportKey, entry]),
  );

  /** @type {BundlerConfig} */
  const bundlerConfig = {
    ...options,
    entries,
    formats,
    tsconfigPath,
    babelConfigPath,
    cwd,
    packageInfo,
  };
  const adapter = await createBundlerAdapter(options.bundler);
  const outputChunks = await adapter.build(bundlerConfig);
  return generateExportsField(outputChunks, entries);
}

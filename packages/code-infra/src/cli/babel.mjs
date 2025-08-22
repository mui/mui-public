/* eslint-disable no-console */
/// <reference types="../untyped-plugins" />

import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { $ } from 'execa';

const TO_TRANSFORM_EXTENSIONS = ['.js', '.ts', '.tsx'];

/**
 * @param {string} pkgVersion
 * @returns {Record<string, string>} An object containing version-related environment variables.
 */
export function getVersionEnvVariables(pkgVersion) {
  if (!pkgVersion) {
    throw new Error('No version found in package.json');
  }

  const [versionNumber, prerelease] = pkgVersion.split('-');
  const [major, minor, patch] = versionNumber.split('.');

  if (!major || !minor || !patch) {
    throw new Error(`Couldn't parse version from package.json`);
  }

  return {
    MUI_VERSION: pkgVersion,
    MUI_MAJOR_VERSION: major,
    MUI_MINOR_VERSION: minor,
    MUI_PATCH_VERSION: patch,
    MUI_PRERELEASE: prerelease,
  };
}

/**
 * Copies CommonJS files from one directory to another.
 * @param {Object} param0
 * @param {string} param0.from - The source directory.
 * @param {string} param0.to - The destination directory.
 * @returns {Promise<void>}
 */
export async function cjsCopy({ from, to }) {
  if (
    !(await fs
      .stat(to)
      .then(() => true)
      .catch(() => false))
  ) {
    console.warn(`path ${to} does not exists`);
    return;
  }

  const files = await globby('**/*.cjs', { cwd: from });
  const cmds = files.map((file) => fs.cp(path.resolve(from, file), path.resolve(to, file)));
  await Promise.all(cmds);
}

/**
 * @typedef {Object} ErrorCodeMetadata
 * @property {string} outputPath - The path where the error code file should be written.
 * @property {'annotate' | 'throw' | 'write'} [missingError] - How to handle missing error codes.
 * @property {string} [runtimeModule] - The runtime module to replace the errors with.
 */

const BASE_IGNORES = [
  '**/*.test.js',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.js',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.d.ts',
  '**/*.test/*.*',
  '**/test-cases/*.*',
];

/**
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Whether to enable verbose logging.
 * @param {boolean} [options.optimizeClsx=false] - Whether to enable clsx call optimization transform.
 * @param {boolean} [options.removePropTypes=true] - Whether to enable removal of React prop types.
 * @param {string[]} [options.ignores] - The globs to be ignored by Babel.
 * @param {string} options.cwd - The package root directory.
 * @param {string} options.pkgVersion - The package version.
 * @param {string} options.sourceDir - The source directory to build from.
 * @param {string} options.outDir - The output directory for the build.
 * @param {string} options.outExtension - The output file extension for the build.
 * @param {boolean} options.hasLargeFiles - Whether the build includes large files.
 * @param {import('../utils/build.mjs').BundleType} options.bundle - The bundles to build.
 * @param {string} options.babelRuntimeVersion - The version of @babel/runtime to use.
 * @returns {Promise<void>}
 */
export async function babelBuild({
  cwd,
  sourceDir,
  outDir,
  babelRuntimeVersion,
  hasLargeFiles,
  bundle,
  pkgVersion,
  outExtension,
  optimizeClsx = false,
  removePropTypes = false,
  verbose = false,
  ignores = [],
}) {
  console.log(
    `Transpiling files to "${path.relative(path.dirname(sourceDir), outDir)}" for "${bundle}" bundle.`,
  );
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error(`No workspace found for ${cwd}`);
  }
  let configFile = path.join(workspaceDir, 'babel.config.js');
  if (
    !(await fs
      .stat(configFile)
      .then(() => true)
      .catch(() => false))
  ) {
    configFile = path.join(workspaceDir, 'babel.config.mjs');
  }
  const env = {
    NODE_ENV: 'production',
    BABEL_ENV: bundle === 'esm' ? 'stable' : 'node',
    MUI_BUILD_VERBOSE: verbose ? 'true' : undefined,
    MUI_OPTIMIZE_CLSX: optimizeClsx ? 'true' : undefined,
    MUI_REMOVE_PROP_TYPES: removePropTypes ? 'true' : undefined,
    MUI_BABEL_RUNTIME_VERSION: babelRuntimeVersion,
    MUI_OUT_FILE_EXTENSION: outExtension ?? '.js',
    ...getVersionEnvVariables(pkgVersion),
  };
  const res = await $({
    stdio: 'inherit',
    preferLocal: true,
    localDir: import.meta.dirname,
    env: {
      ...process.env,
      ...env,
    },
  })`babel --config-file ${configFile} --extensions ${TO_TRANSFORM_EXTENSIONS.join(',')} ${sourceDir} --out-dir ${outDir} --ignore ${BASE_IGNORES.concat(ignores).join(',')} --out-file-extension ${outExtension !== '.js' ? outExtension : '.js'} --compact ${hasLargeFiles ? 'false' : 'auto'}`;

  if (res.stderr) {
    throw new Error(`Command: '${res.escapedCommand}' failed with \n${res.stderr}`);
  }
  if (verbose) {
    console.log(`Command: '${res.escapedCommand}' succeeded with \n${res.stdout}`);
  }

  // cjs for reexporting from commons only modules.
  // If we need to rely more on this we can think about setting up a separate commonjs => commonjs build for .cjs files to .cjs
  // `--extensions-.cjs --out-file-extension .cjs`
  await cjsCopy({ from: sourceDir, to: outDir });
}

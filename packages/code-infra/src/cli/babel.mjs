/* eslint-disable no-console */
/// <reference types="../untyped-plugins" />

import { transformFileAsync } from '@babel/core';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * @type {Record<string, string>}
 */
const OUT_EXTENSION_MAP = {
  '.cjs': '.cjs',
  '.mjs': '.mjs',
  '.cts': '.cjs',
  '.ctsx': '.cjs',
  '.mts': '.mjs',
  '.mtsx': '.mjs',
};

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
 * @typedef {Object} ErrorCodeMetadata
 * @property {string} outputPath - The path where the error code file should be written.
 * @property {'annotate' | 'throw' | 'write'} [missingError] - How to handle missing error codes.
 * @property {string} [runtimeModule] - The runtime module to replace the errors with.
 */

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
  const files = await globby(['**/*.{cjs,js,mjs,cts,ts,mts,cjsx,ctsx,tsx,mtsx}'], {
    cwd: sourceDir,
    gitignore: true,
    ignore: [
      '**/*.d.ts',
      '**/*.d.mts',
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.test/*.*',
      '**/test-cases/*.*',
      ...ignores,
    ],
  });
  console.log(
    `Transpiling ${files.length} files to ${path.relative(path.dirname(sourceDir), outDir)}`,
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
  const envName = bundle === 'esm' ? 'stable' : 'node';
  /**
   * @type {import('@babel/core').TransformOptions}
   */
  const babelConfig = {
    configFile,
    babelrc: false,
    compact: hasLargeFiles,
    browserslistEnv: envName,
    envName,
  };
  const env = {
    MUI_BUILD_VERBOSE: verbose ? 'true' : undefined,
    MUI_OPTIMIZE_CLSX: optimizeClsx ? 'true' : undefined,
    MUI_REMOVE_PROP_TYPES: removePropTypes ? 'true' : undefined,
    MUI_BABEL_RUNTIME_VERSION: babelRuntimeVersion,
    ...getVersionEnvVariables(pkgVersion),
  };
  Object.entries(env).forEach(([key, value]) => {
    if (verbose) {
      console.log(`Setting environment variable: ${key}=${value}`);
    }
    if (typeof value === 'undefined') {
      return;
    }
    process.env[key] = value.toString();
  });

  await Promise.all(
    files.map(async (file) => {
      const result = await transformFileAsync(path.join(sourceDir, file), babelConfig);
      if (!result || !result.code) {
        console.error(`Failed to transform file: ${file}`);
        return;
      }
      const outfileDir = path.dirname(file);
      const basename = path.basename(file);
      if (outfileDir !== '.') {
        await fs.mkdir(path.join(outDir, outfileDir), { recursive: true });
      }
      const ext = path.extname(basename);
      const outFilePath = path.join(
        outDir,
        outfileDir,
        basename.replace(ext, OUT_EXTENSION_MAP[ext] || outExtension),
      );
      await fs.writeFile(outFilePath, result.code, { encoding: 'utf8' });
    }),
  );

  if (verbose) {
    console.log('Resetting environment variables.');
  }
  Object.keys(env).forEach((key) => {
    delete process.env[key];
  });
}

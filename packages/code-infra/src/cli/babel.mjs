/* eslint-disable no-console */
/// <reference types="../untyped-plugins" />

import { transformFileAsync } from '@babel/core';
import pluginTransformRuntime from '@babel/plugin-transform-runtime';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';
import pluginDisplayName from '@mui/internal-babel-plugin-display-name';
import pluginMinifyErrors from '@mui/internal-babel-plugin-minify-errors';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginOptimizeClsx from 'babel-plugin-optimize-clsx';
import pluginSearchAndReplace from 'babel-plugin-search-and-replace';
import pluginTransformInlineEnvVars from 'babel-plugin-transform-inline-environment-variables';
import pluginRemovePropTypes from 'babel-plugin-transform-react-remove-prop-types';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const missingError = process.env.MUI_EXTRACT_ERROR_CODES === 'true' ? 'write' : 'annotate';

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
 * @typedef {'esm' | 'cjs'} BundleType
 */

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
 * @typedef {Object} BuildConfig
 * @property {string} [errorCodesPath] - The path to the error codes JSON file.
 * @property {string} [cjsOutDir] - The output directory for CommonJS files.
 * @property {string} [searchAndReplaceModule] - The module to use for search and replace transformations.
 */

/**
 * @typedef {Object} ErrorCodeMetadata
 * @property {string} outputPath - The path where the error code file should be written.
 * @property {'annotate' | 'throw' | 'write'} [missingError] - How to handle missing error codes.
 * @property {string} [runtimeModule] - The runtime module to replace the errors with.
 */

/**
 * Creates a Babel configuration object for building a project.
 * @param {Object} options
 * @param {boolean} [options.debug] - Enable debug mode.
 * @param {string} [options.errorCodesPath] - Path to the error codes JSON file.
 * @param {string} [options.searchAndReplaceModule] - Specify the module for search and replace transformations.
 * @param {boolean} [options.optimizeClsx] - Enable optimization for clsx calls.
 * @param {boolean} [options.removePropTypes] - Enable removal of React prop types.
 * @param {BundleType} options.bundle - Output ES modules instead of CommonJS.
 * @param {string} options.outExtension - Specify the output file extension.
 * @param {string} options.runtimeVersion - Specify the @babel/runtime package version.
 * @returns {Promise<import("@babel/core").TransformOptions>}
 */
async function getBabelConfig({
  debug = false,
  bundle,
  errorCodesPath,
  runtimeVersion,
  optimizeClsx = false,
  removePropTypes = false,
  outExtension,
  searchAndReplaceModule,
}) {
  /**
   * @type {import('@babel/preset-env').Options}
   */
  const presetEnvOptions = {
    bugfixes: true,
    debug,
    modules: bundle === 'esm' ? false : 'commonjs',
    // @TODO
    browserslistEnv: bundle === 'esm' ? 'stable' : 'node',
  };
  /**
   * @type {import('@babel/core').TransformOptions["plugins"]}
   */
  const plugins = [
    [
      pluginTransformRuntime,
      {
        version: runtimeVersion,
        regenerator: false,
        useESModules: bundle === 'esm',
      },
    ],
    [pluginDisplayName],
    [
      pluginTransformInlineEnvVars,
      {
        include: [
          'MUI_VERSION',
          'MUI_MAJOR_VERSION',
          'MUI_MINOR_VERSION',
          'MUI_PATCH_VERSION',
          'MUI_PRERELEASE',
        ],
      },
    ],
  ];

  if (removePropTypes) {
    plugins.push([
      pluginRemovePropTypes,
      {
        mode: 'unsafe-wrap',
      },
    ]);
  }

  if (errorCodesPath) {
    plugins.push([
      pluginMinifyErrors,
      {
        missingError,
        errorCodesPath,
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
    ]);
  }

  if (optimizeClsx) {
    plugins.push([pluginOptimizeClsx]);
  }

  if (searchAndReplaceModule) {
    const pluginOptions = await import(searchAndReplaceModule);
    plugins.push([pluginSearchAndReplace, pluginOptions.default]);
  }

  if (bundle === 'esm') {
    plugins.push([pluginResolveImports, { outExtension }]);
  }

  return {
    assumptions: {
      noDocumentAll: true,
      // With our case these assumptions are safe, and the
      // resulting behavior is equivalent to spec mode.
      setPublicClassFields: true,
      privateFieldsAsProperties: true,
      objectRestNoSymbols: true,
      setSpreadProperties: true,
    },
    ignore: [
      // Fix a Windows issue.
      /@babel[\\|/]runtime/,
      // Fix const foo = /{{(.+?)}}/gs; crashing.
      /prettier/,
      '**/*.template.js',
    ],
    presets: [
      [presetEnv, presetEnvOptions],
      [presetReact, { runtime: 'automatic' }],
      [presetTypescript],
    ],
    plugins,
  };
}

/**
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Whether to enable verbose logging.
 * @param {boolean} [options.optimizeClsx=false] - Whether to enable clsx call optimization transform.
 * @param {boolean} [options.removePropTypes=true] - Whether to enable removal of React prop types.
 * @param {BuildConfig} [options.buildConfig] - The build configuration.
 * @param {string[]} [options.ignores] - The globs to be ignored by Babel.
 * @param {string} options.pkgVersion - The package version.
 * @param {string} options.sourceDir - The source directory to build from.
 * @param {string} options.outDir - The output directory for the build.
 * @param {string} options.outExtension - The output file extension for the build.
 * @param {boolean} options.hasLargeFiles - Whether the build includes large files.
 * @param {BundleType} options.bundle - The bundles to build.
 * @param {string} options.babelRuntimeVersion - The version of @babel/runtime to use.
 * @returns {Promise<void>}
 */
export async function babelBuild({
  sourceDir,
  outDir,
  babelRuntimeVersion,
  hasLargeFiles,
  bundle,
  buildConfig,
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
  const babelConfig = {
    ...(await getBabelConfig({
      debug: verbose,
      runtimeVersion: babelRuntimeVersion,
      bundle,
      optimizeClsx,
      removePropTypes,
      errorCodesPath: buildConfig?.errorCodesPath,
      searchAndReplaceModule: buildConfig?.searchAndReplaceModule,
      outExtension,
    })),
    configFile: false,
    babelrc: false,
    compact: hasLargeFiles,
  };
  const env = {
    NODE_ENV: 'production',
    BABEL_ENV: bundle === 'esm' ? 'stable' : 'node',
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
}

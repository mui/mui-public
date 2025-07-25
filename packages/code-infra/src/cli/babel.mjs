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
import pluginTransformInlineEnvVars from 'babel-plugin-transform-inline-environment-variables';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
 */

/**
 * @param {BundleType} bundle
 */
export function getOutExtension(bundle) {
  return bundle === 'esm' ? '.mjs' : '.js';
}

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
 * @param {boolean} [options.optimizeClsx] - Enable optimization for clsx calls.
 * @param {'annotate' | 'throw' | 'write'} [options.missingError] - How to handle missing error codes.
 * @param {BundleType} options.bundle - Output ES modules instead of CommonJS.
 * @param {string} options.runtimeVersion - Specify the @babel/runtime package version.
 * @returns {import("@babel/core").TransformOptions}
 */
function getBabelConfig({
  debug = false,
  bundle,
  errorCodesPath,
  // missingError,
  runtimeVersion,
  optimizeClsx,
}) {
  /**
   * @type {import('@babel/preset-env').Options}
   */
  const presetEnvOptions = {
    bugfixes: true,
    debug,
    modules: bundle === 'esm' ? false : 'commonjs',
    // @TODO
    browserslistEnv: process.env.NODE_ENV,
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

  if (errorCodesPath) {
    plugins.push([
      pluginMinifyErrors,
      {
        missingError: 'annotate',
        errorCodesPath,
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
    ]);
  }

  if (optimizeClsx) {
    plugins.push([pluginOptimizeClsx]);
  }

  if (bundle === 'esm') {
    plugins.push([pluginResolveImports, { outExtension: getOutExtension(bundle) }]);
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
 * @param {BuildConfig} [options.buildConfig] - The build configuration.
 * @param {string} options.pkgVersion - The package version.
 * @param {string} options.sourceDir - The source directory to build from.
 * @param {string} options.outDir - The output directory for the build.
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
  optimizeClsx = false,
  verbose = false,
}) {
  await fs.mkdir(outDir, { recursive: true });
  // Implementation goes here
  const files = await globby(['**/*.{cjs,js,mjs,cts,ts,mts,cjsx,ctsx,tsx,mtsx}'], {
    cwd: sourceDir,
    gitignore: true,
    ignore: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*', '**/*.test/*.*', '**/test-cases/*.*'],
  });
  console.log(
    `Transpiling ${files.length} files to ${path.relative(path.dirname(sourceDir), outDir)}`,
  );
  const babelConfig = getBabelConfig({
    debug: verbose,
    runtimeVersion: babelRuntimeVersion,
    bundle,
    optimizeClsx,
    errorCodesPath: buildConfig?.errorCodesPath,
  });
  const outFileExtension = getOutExtension(bundle);
  const env = {
    NODE_ENV: 'production',
    BABEL_ENV: bundle === 'esm' ? 'stable' : 'node',
    MUI_BUILD_VERBOSE: verbose,
    MUI_BABEL_RUNTIME_VERSION: babelRuntimeVersion,
    MUI_OUT_FILE_EXTENSION: outFileExtension,
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
  const dirCreatedSet = new Set();

  await Promise.all(
    files.map(async (file) => {
      const result = await transformFileAsync(path.join(sourceDir, file), {
        ...babelConfig,
        configFile: false,
        babelrc: false,
        compact: hasLargeFiles,
      });
      if (!result || !result.code) {
        console.error(`Failed to transform file: ${file}`);
        return;
      }
      const outfileDir = path.dirname(file);
      const basename = path.basename(file);
      if (outfileDir !== '.' && !dirCreatedSet.has(outfileDir)) {
        await fs.mkdir(path.join(outDir, outfileDir), { recursive: true });
        dirCreatedSet.add(outfileDir);
      }
      const ext = path.extname(basename);
      const outFilePath = path.join(
        outDir,
        outfileDir,
        basename.replace(ext, `.${getOutExtension(bundle)}`),
      );
      await fs.writeFile(outFilePath, result.code, { encoding: 'utf8' });
    }),
  );
}

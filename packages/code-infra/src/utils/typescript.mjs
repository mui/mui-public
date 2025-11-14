/* eslint-disable no-console */
import * as babel from '@babel/core';
import pluginTypescriptSyntax from '@babel/plugin-syntax-typescript';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginRemoveImports from 'babel-plugin-transform-remove-imports';
import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { mapConcurrently } from '../utils/build.mjs';
import { tsAddExplicitUndefined } from './tsAddExplicitUndefined.mjs';

const $$ = $({ stdio: 'inherit' });

/**
 * Emits TypeScript declaration files.
 * @param {string} tsconfig - The path to the tsconfig.json file.
 * @param {string} outDir - The output directory for the declaration files.
 */
export async function emitDeclarations(tsconfig, outDir) {
  const tsconfigDir = path.dirname(tsconfig);
  const rootDir = path.resolve(tsconfigDir, './src');
  await $$`tsc
    -p ${tsconfig}
    --rootDir ${rootDir}
    --outDir ${outDir}
    --declaration
    --emitDeclarationOnly
    --noEmit false
    --composite false
    --incremental false
    --declarationMap false`;
}

/**
 * @param {string} sourceDirectory
 * @param {string} destinationDirectory
 */
export async function copyDeclarations(sourceDirectory, destinationDirectory) {
  const fullSourceDirectory = path.resolve(sourceDirectory);
  const fullDestinationDirectory = path.resolve(destinationDirectory);

  console.log(`Copying declarations from ${fullSourceDirectory} to ${fullDestinationDirectory}`);

  await fs.cp(fullSourceDirectory, fullDestinationDirectory, {
    recursive: true,
    filter: async (src) => {
      if (src.startsWith('.')) {
        // ignore dotfiles
        return false;
      }
      const stats = await fs.stat(src);
      if (stats.isDirectory()) {
        return true;
      }
      return src.endsWith('.d.ts') || src.endsWith('.d.mts');
    },
  });
}

/**
 * Post-processes TypeScript declaration files.
 * @param {Object} param0
 * @param {string} param0.directory - The directory containing the declaration files.
 */
async function postProcessDeclarations({ directory }) {
  const dtsFiles = await globby('**/*.d.ts', {
    absolute: true,
    cwd: directory,
  });
  if (dtsFiles.length === 0) {
    console.log(`No d.ts files found in ${directory}. Skipping post-processing.`);
    return;
  }

  /**
   * @type {import('@babel/core').PluginItem[]}
   */
  const babelPlugins = [
    [pluginTypescriptSyntax, { dts: true }],
    [pluginResolveImports],
    [pluginRemoveImports, { test: /\.css$/ }],
  ];

  await mapConcurrently(
    dtsFiles,
    async (dtsFile) => {
      const result = await babel.transformFileAsync(dtsFile, {
        configFile: false,
        plugins: babelPlugins,
      });

      if (typeof result?.code === 'string') {
        await fs.writeFile(dtsFile, result.code);
      } else {
        console.error('failed to transform', dtsFile);
      }
    },
    20,
  );
}

/**
 * Renames TypeScript declaration files.
 * @param {Object} param0
 * @param {string} param0.directory - The directory containing the declaration files.
 */
async function renameDeclarations({ directory }) {
  const dtsFiles = await globby('**/*.d.ts', { absolute: true, cwd: directory });
  if (dtsFiles.length === 0) {
    return;
  }
  console.log(`Renaming d.ts files to d.mts in ${directory}`);
  await mapConcurrently(
    dtsFiles,
    async (dtsFile) => {
      const newFileName = dtsFile.replace(/\.d\.ts$/, '.d.mts');
      await fs.rename(dtsFile, newFileName);
    },
    20,
  );
}

/**
 * Creates TypeScript declaration files for the specified bundles.
 * Types are first created in a temporary directory and then copied to the appropriate bundle directories parallelly.
 * After copying, babel transformations are applied to the copied files because they need to be alongside the actual js files for proper resolution.
 *
 * @param {Object} param0
 * @param {boolean} [param0.isMjsBuild] - Whether the build is for ESM (ECMAScript Modules).
 * @param {{type: import('../utils/build.mjs').BundleType, dir: string}[]} param0.bundles - The bundles to create declarations for.
 * @param {string} param0.srcDir - The source directory.
 * @param {string} param0.buildDir - The build directory.
 * @param {string} param0.cwd - The current working directory.
 * @param {boolean} param0.skipTsc - Whether to skip running TypeScript compiler (tsc) for building types.
 */
export async function createTypes({ bundles, srcDir, buildDir, cwd, skipTsc, isMjsBuild }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-build-tsc-'));

  try {
    await copyDeclarations(srcDir, tmpDir);
    const tsconfigPath = path.join(cwd, 'tsconfig.build.json');
    const tsconfigExists = await fs.stat(tsconfigPath).then(
      (file) => file.isFile(),
      () => false,
    );
    if (!skipTsc) {
      if (!tsconfigExists) {
        throw new Error(
          'Unable to find a tsconfig to build this project. ' +
            `The package root needs to contain a 'tsconfig.build.json'. ` +
            `The package root is '${cwd}'`,
        );
      }
      console.log(`Building types for ${tsconfigPath} in ${tmpDir}`);
      await emitDeclarations(tsconfigPath, tmpDir);
    }

    await tsAddExplicitUndefined(tmpDir);

    for (const bundle of bundles) {
      const { type: bundleType, dir: bundleOutDir } = bundle;
      const fullOutDir = path.join(buildDir, bundleOutDir);
      // eslint-disable-next-line no-await-in-loop
      await fs.cp(tmpDir, fullOutDir, {
        recursive: true,
        force: false,
      });
      // eslint-disable-next-line no-await-in-loop
      await postProcessDeclarations({
        directory: fullOutDir,
      });
      if (bundleType === 'esm' && isMjsBuild) {
        // eslint-disable-next-line no-await-in-loop
        await renameDeclarations({
          directory: fullOutDir,
        });
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

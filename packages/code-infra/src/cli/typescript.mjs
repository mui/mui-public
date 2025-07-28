/* eslint-disable no-console */
import * as babel from '@babel/core';
import pluginTypescriptSyntax from '@babel/plugin-syntax-typescript';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import pluginRemoveImports from 'babel-plugin-transform-remove-imports';
import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const $$ = $({ stdio: 'inherit' });

/**
 * Emits TypeScript declaration files.
 * @param {string} tsconfig - The path to the tsconfig.json file.
 * @param {string} outDir - The output directory for the declaration files.
 */
export async function emitDeclarations(tsconfig, outDir) {
  console.log(`Building types for ${tsconfig} in ${outDir}`);
  await $$`tsc -p ${tsconfig} --outDir ${outDir} --declaration --emitDeclarationOnly`;
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
    errorOnExist: false,
    filter: async (src) => {
      if (src.startsWith('.')) {
        // ignore dotfiles
        return false;
      }
      const stats = await fs.stat(src);
      if (stats.isDirectory()) {
        return true;
      }
      return src.endsWith('.d.ts');
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

  await Promise.all(
    dtsFiles.map(async (dtsFile) => {
      const result = await babel.transformFileAsync(dtsFile, {
        configFile: false,
        plugins: babelPlugins,
      });

      if (typeof result?.code === 'string') {
        await fs.writeFile(dtsFile, result.code);
      } else {
        console.error('failed to transform', dtsFile);
      }
    }),
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
  console.log(`Renaming d.ts files to d.mts declaration files in ${directory}`);
  await Promise.all(
    dtsFiles.map(async (dtsFile) => {
      const newFileName = dtsFile.replace(/\.d\.ts$/, '.d.mts');
      await fs.rename(dtsFile, newFileName);
    }),
  );
}

/**
 * Generates types for the package.
 * @param {Object} param0
 * @param {string} param0.srcDir - The source directory.
 * @param {string} param0.outDir - The base output directory.
 * @param {import('./babel.mjs').BundleType} param0.bundle - The bundle type to process.
 * @param {string} param0.cwd - The current working directory.
 * @param {boolean} param0.skipTsc - Whether to skip running TypeScript compiler (tsc) for building types.
 * @param {boolean} param0.isMjsBuild - Whether the build is for ESM (ECMAScript Modules).
 */
export async function generateTypes({ srcDir, outDir, cwd, skipTsc, bundle, isMjsBuild }) {
  await copyDeclarations(srcDir, outDir);

  const tsconfigPath = path.join(cwd, 'tsconfig.build.json');
  const tsconfigExists = await fs.access(tsconfigPath).then(
    () => true,
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
    await emitDeclarations(tsconfigPath, outDir);
  }

  if (bundle === 'esm' && isMjsBuild) {
    await renameDeclarations({
      directory: outDir,
    });
  }

  await postProcessDeclarations({
    directory: outDir,
  });

  // const tsbuildinfo = await globby('**/*.tsbuildinfo', {
  //   absolute: true,
  //   cwd: path.dirname(outDir),
  // });
  // await Promise.all(tsbuildinfo.map(async (file) => fs.rm(file)));
}

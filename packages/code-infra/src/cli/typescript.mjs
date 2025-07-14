/* eslint-disable no-console */
import * as babel from '@babel/core';
import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const $$ = $({ stdio: 'inherit' });

/**
 * Emits TypeScript declaration files.
 * @param {string} tsconfig - The path to the tsconfig.json file.
 * @param {string} outDir - The output directory for the declaration files.
 * @param {string} bundle - The bundle type to process.
 */
export async function emitDeclarations(tsconfig, outDir, bundle) {
  console.log(`Building types for ${path.resolve(tsconfig)} in ${outDir}`);
  await $$`tsc -p ${tsconfig} --outDir ${outDir} --declaration --emitDeclarationOnly --tsBuildInfoFile node_modules/.cache/tsconfig-${bundle}.tsbuildinfo`;
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
      return src.endsWith('.d.ts');
    },
  });
}

/**
 * Post-processes TypeScript declaration files.
 * @param {Object} param0
 * @param {string} param0.directory - The directory containing the declaration files.
 * @param {boolean} [param0.removeCss=false] - Whether to remove CSS imports from the declarations.
 */
async function postProcessDeclarations({ directory, removeCss = false }) {
  const dtsFiles = await globby('**/*.d.ts', { absolute: true, cwd: directory });
  if (dtsFiles.length === 0) {
    throw new Error(`Unable to find declaration files in '${directory}'`);
  }

  /**
   * @type {import('@babel/core').PluginItem[]}
   */
  const babelPlugins = [
    ['@babel/plugin-syntax-typescript', { dts: true }],
    ['@mui/internal-babel-plugin-resolve-imports'],
  ];

  if (removeCss) {
    babelPlugins.push(['babel-plugin-transform-remove-imports', { test: /\.css$/ }]);
  }

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
 * @param {string} param0.outDir - The base output directory.
 * @param {string} param0.relativeOutDir - The relative output directory for the bundle
 * @param {string} param0.bundle - The bundle type to process.
 * @param {string} param0.cwd - The current working directory.
 * @param {boolean} param0.skipTsc - Whether to skip running TypeScript compiler (tsc) for building types.
 */
export async function generateTypes({ outDir, relativeOutDir, cwd, skipTsc, bundle }) {
  const srcPath = path.join(cwd, 'src');
  const destPath = path.join(cwd, outDir, relativeOutDir);
  await copyDeclarations(srcPath, destPath);

  const tsconfigPath = path.join(cwd, 'tsconfig.build.json');
  const tsconfigExists = await fs.access(tsconfigPath).then(
    () => true,
    () => false,
  );
  if (!skipTsc) {
    if (!tsconfigExists) {
      throw new Error(`tsconfig.build.json not found at ${tsconfigPath}.`);
    }
    await emitDeclarations(tsconfigPath, path.join(outDir, relativeOutDir), bundle);
  }
  await postProcessDeclarations({
    directory: destPath,
  });

  if (bundle === 'esm') {
    await renameDeclarations({
      directory: destPath,
    });
  }
}

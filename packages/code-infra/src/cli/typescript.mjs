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
  console.log(`Renaming d.ts files to d.mts in ${directory}`);
  await Promise.all(
    dtsFiles.map(async (dtsFile) => {
      const newFileName = dtsFile.replace(/\.d\.ts$/, '.d.mts');
      await fs.rename(dtsFile, newFileName);
    }),
  );
}

/**
 * Creates TypeScript declaration files for the specified bundles.
 * This is a very hard-coded process where the types are first created in build/esm directory
 * regardless of user input bundles. These are then copied over to other bundle directories
 * to avoid triggering tsc cli again and again.
 * The whole pipeline is same as that in core-repo's `scripts/buildTypes.mts`
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
  // const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-build-tsc-'));
  // Actual os-level tmpdir doesn't work here because of our usage of babel-plugin-resolve-imports plugin which
  // adds extension based on the existense of the relevant js files.
  const tmpDir = path.join(buildDir, 'esm');

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
      await emitDeclarations(tsconfigPath, tmpDir);
    }
    await postProcessDeclarations({
      directory: tmpDir,
    });

    await Promise.all(
      bundles.map(async ({ type: bundleType, dir: bundleOutDir }) => {
        const fullOutDir = path.join(buildDir, bundleOutDir);
        if (bundleType !== 'esm') {
          await fs.cp(tmpDir, fullOutDir, {
            recursive: true,
            force: true,
            filter: (file) => file.endsWith('.d.ts'),
          });
        }
        if (bundleType === 'esm' && isMjsBuild) {
          await renameDeclarations({
            directory: fullOutDir,
          });
        }
      }),
    );
  } finally {
    if (bundles.length === 1 && bundles[0].type !== 'esm') {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

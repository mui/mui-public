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
import { getOutExtension, mapConcurrently } from '../utils/build.mjs';

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
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 */
export async function copyDeclarations(sourceDirectory, destinationDirectory, options = {}) {
  const fullSourceDirectory = path.resolve(sourceDirectory);
  const fullDestinationDirectory = path.resolve(destinationDirectory);

  if (options.verbose) {
    console.log(`Copying declarations from ${fullSourceDirectory} to ${fullDestinationDirectory}`);
  }
  await fs.cp(fullSourceDirectory, fullDestinationDirectory, {
    recursive: true,
    filter: async (src) => {
      // Ignore dotfiles and dot-directories based on basename for cross-platform correctness
      if (path.basename(src).startsWith('.')) {
        // ignore dotfiles
        return false;
      }
      const stats = await fs.stat(src);
      if (stats.isDirectory()) {
        return true;
      }
      return src.endsWith('.d.ts') || src.endsWith('.d.mts') || src.endsWith('.d.cts');
    },
  });
}

/**
 *
 * @param {Object} param0
 * @param {string} param0.inputDir
 * @param {string} param0.buildDir
 * @param {{type: import('../utils/build.mjs').BundleType, dir: string}[]} param0.bundles
 * @param {boolean} [param0.isFlat]
 * @param {'module' | 'commonjs'} [param0.packageType]
 * @returns
 */
export async function moveAndTransformDeclarations({
  inputDir,
  buildDir,
  bundles,
  isFlat,
  packageType,
}) {
  // Directly copy to the bundle directory if there's only one bundle, mainly for esm, since
  // the js files are inside 'esm' folder. resolve-imports plugin needs d.ts to be alongside js files to
  // resolve paths correctly.
  const toCopyDir = bundles.length === 1 ? path.join(buildDir, bundles[0].dir) : buildDir;
  await fs.cp(inputDir, toCopyDir, {
    recursive: true,
    force: false,
  });

  const dtsFiles = await globby('**/*.d.ts', { absolute: true, cwd: toCopyDir });
  if (dtsFiles.length === 0) {
    console.log(`No d.ts files found in ${toCopyDir}. Skipping transformation.`);
    return;
  }

  await mapConcurrently(
    dtsFiles,
    async (dtsFile) => {
      // Normalize to native separators to make path comparisons reliable on Windows
      const nativeDtsFile = path.normalize(dtsFile);
      const content = await fs.readFile(nativeDtsFile, 'utf8');
      const relativePath = path.relative(toCopyDir, nativeDtsFile);

      const writesToOriginalPath =
        isFlat &&
        bundles.some((bundle) => {
          const newFileExtension = getOutExtension(bundle.type, {
            isFlat,
            isType: true,
            packageType,
          });
          const outFileRelative = relativePath.replace(/\.d\.ts$/, newFileExtension);
          const outFilePath = path.join(buildDir, bundle.dir, outFileRelative);
          // Ensure both paths are normalized before comparison (fixes Windows posix vs win32 separators)
          return path.resolve(outFilePath) === path.resolve(nativeDtsFile);
        });

      await Promise.all(
        bundles.map(async (bundle) => {
          const importExtension = getOutExtension(bundle.type, {
            isFlat,
            packageType,
          });
          const newFileExtension = getOutExtension(bundle.type, {
            isFlat,
            isType: true,
            packageType,
          });
          const outFileRelative = isFlat
            ? relativePath.replace(/\.d\.ts$/, newFileExtension)
            : relativePath;
          const outFilePath = path.join(buildDir, bundle.dir, outFileRelative);

          const babelPlugins = [
            [pluginTypescriptSyntax, { dts: true }],
            [pluginResolveImports, { outExtension: importExtension }],
            [pluginRemoveImports, { test: /\.css$/ }],
          ];
          const result = await babel.transformAsync(content, {
            configFile: false,
            plugins: babelPlugins,
            filename: nativeDtsFile,
          });
          if (typeof result?.code === 'string') {
            await fs.mkdir(path.dirname(outFilePath), { recursive: true });
            await fs.writeFile(outFilePath, result.code);
          } else {
            console.error('failed to transform', dtsFile);
          }
        }),
      );
      if (isFlat && !writesToOriginalPath) {
        await fs.unlink(nativeDtsFile);
      }
    },
    30,
  );
}

/**
 * Creates TypeScript declaration files for the specified bundles.
 * Types are first created in a temporary directory and then copied to the appropriate bundle directories parallelly.
 * After copying, babel transformations are applied to the copied files because they need to be alongside the actual js files for proper resolution.
 *
 * @param {Object} param0
 * @param {boolean} [param0.isFlat = false] - Whether the build is for ESM (ECMAScript Modules).
 * @param {boolean} [param0.verbose = false] - Whether the build is for ESM (ECMAScript Modules).
 * @param {{type: import('../utils/build.mjs').BundleType, dir: string}[]} param0.bundles - The bundles to create declarations for.
 * @param {string} param0.srcDir - The source directory.
 * @param {string} param0.buildDir - The build directory.
 * @param {string} param0.cwd - The current working directory.
 * @param {boolean} param0.skipTsc - Whether to skip running TypeScript compiler (tsc) for building types.
 * @param {'module' | 'commonjs'} [param0.packageType] - The package.json type field.
 */
export async function createTypes({
  bundles,
  srcDir,
  buildDir,
  cwd,
  skipTsc,
  isFlat,
  packageType,
  verbose,
}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-build-tsc-'));

  try {
    await copyDeclarations(srcDir, tmpDir, { verbose });
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
    await moveAndTransformDeclarations({
      inputDir: tmpDir,
      buildDir,
      bundles,
      isFlat,
      packageType,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/* eslint-disable no-console */
import * as babel from '@babel/core';
import pluginTypescriptSyntax from '@babel/plugin-syntax-typescript';
import pluginResolveImports from '@mui/internal-babel-plugin-resolve-imports';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import pluginRemoveImports from 'babel-plugin-transform-remove-imports';
import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getOutExtension, mapConcurrently } from '../utils/build.mjs';

const $$ = $({ stdio: 'inherit' });

/**
 * Checks if tsgo CLI is available in the workspace's node_modules.
 * @param {string} cwd - The current working directory to start searching from.
 * @returns {Promise<string | null>} - The path to tsgo if found, null otherwise.
 */
async function findTsgo(cwd) {
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    return null;
  }
  const tsgoPath = path.join(workspaceDir, 'node_modules', '.bin', 'tsgo');
  const exists = await fs.stat(tsgoPath).then(
    (stat) => stat.isFile(),
    () => false,
  );
  return exists ? tsgoPath : null;
}

/**
 * Emits TypeScript declaration files.
 * @param {string} tsconfig - The path to the tsconfig.json file.
 * @param {string} outDir - The output directory for the declaration files.
 * @param {Object} options
 * @param {boolean} [options.useTsgo] - Whether to use typescript native (tsgo).
 */
export async function emitDeclarations(tsconfig, outDir, options) {
  const { useTsgo = false } = options ?? {};
  const tsconfigDir = path.dirname(tsconfig);
  const rootDir = path.resolve(tsconfigDir, './src');

  const tsgoPath = useTsgo ? await findTsgo(tsconfigDir) : null;
  if (useTsgo && !tsgoPath) {
    throw new Error(
      '--tsgo flag was passed or MUI_USE_TSGO environment was set but no tsgo cli was found. Either remove the flag to use tsc or install the native package "@typescript/native-preview" at the workspace level to use tsgo.',
    );
  }

  if (tsgoPath) {
    console.log('Using tsgo for declaration emit');
    await $$`${tsgoPath}
      -p ${tsconfig}
      --rootDir ${rootDir}
      --outDir ${outDir}
      --declaration
      --emitDeclarationOnly
      --noEmit false
      --composite false
      --incremental false
      --declarationMap false`;
  } else {
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
 *
 * @param {Object} param0
 * @param {string} param0.inputDir
 * @param {string} param0.buildDir
 * @param {{type: import('../utils/build.mjs').BundleType, dir: string}[]} param0.bundles
 * @param {boolean} [param0.isFlat]
 * @returns
 */
export async function moveAndTransformDeclarations({ inputDir, buildDir, bundles, isFlat }) {
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
      const content = await fs.readFile(dtsFile, 'utf8');
      const relativePath = path.relative(toCopyDir, dtsFile);

      await Promise.all(
        bundles.map(async (bundle) => {
          const importExtension = getOutExtension(bundle.type, {
            isFlat,
          });
          const newFileExtension = getOutExtension(bundle.type, {
            isFlat,
            isType: true,
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
            filename: dtsFile,
          });
          if (typeof result?.code === 'string') {
            await fs.writeFile(outFilePath, result.code);
          } else {
            console.error('failed to transform', dtsFile);
          }
        }),
      );
      if (isFlat) {
        await fs.unlink(dtsFile);
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
 * @param {boolean} [param0.isFlat] - Whether the build is for ESM (ECMAScript Modules).
 * @param {{type: import('../utils/build.mjs').BundleType, dir: string}[]} param0.bundles - The bundles to create declarations for.
 * @param {string} param0.srcDir - The source directory.
 * @param {string} param0.buildDir - The build directory.
 * @param {string} param0.cwd - The current working directory.
 * @param {boolean} param0.skipTsc - Whether to skip running TypeScript compiler (tsc) for building types.
 * @param {boolean} [param0.useTsgo=false] - Whether to build types using typescript native (tsgo).
 */
export async function createTypes({
  bundles,
  srcDir,
  buildDir,
  cwd,
  skipTsc,
  useTsgo = false,
  isFlat = false,
}) {
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
      await emitDeclarations(tsconfigPath, tmpDir, { useTsgo });
    }
    await moveAndTransformDeclarations({ inputDir: tmpDir, buildDir, bundles, isFlat });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

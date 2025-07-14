/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { generateTypes } from './typescript.mjs';

/**
 * @typedef {Object} Args
 * @property {('cjs' | 'esm')[]} bundle - The bundles to build.
 * @property {boolean} hasLargeFiles - The large files to build.
 * @property {boolean} skipModulePackageJson - Whether to skip generating a package.json file in the /esm folder.
 * @property {string} cjsDir - The directory to copy the cjs files to.
 * @property {string} esmDir - The directory to copy the esm files to.
 * @property {boolean} verbose - Whether to enable verbose logging.
 * @property {boolean} buildTypes - Whether to build types for the package.
 * @property {boolean} skipTsc - Whether to build types for the package.
 * @property {string[]} ignore - Globs to be ignored by Babel.
 */

const exec = promisify(childProcess.exec);

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
 * @type {Record<string, string>} - The file extensions for the output files based on the bundle type.
 */
const OUT_FILE_EXTENSION = {
  cjs: '.js',
  esm: '.mjs',
};

/**
 * Returns the version and destructured values of the version as env variables to be replaced.
 * @param {string} packageVersion - The version from package.json.
 * @returns {Record<string, string>} An object containing the version and destructured values.
 */
export function getVersionEnvVariables(packageVersion) {
  const version = packageVersion;
  if (!version) {
    throw new Error('No version found in package.json');
  }

  const [versionNumber, prerelease] = version.split('-');
  const [major, minor, patch] = versionNumber.split('.');

  if (!major || !minor || !patch) {
    throw new Error(`Couldn't parse version from package.json`);
  }

  return {
    MUI_VERSION: version,
    MUI_MAJOR_VERSION: major,
    MUI_MINOR_VERSION: minor,
    MUI_PATCH_VERSION: patch,
    MUI_PRERELEASE: prerelease,
  };
}

const validBundles = [
  // build for node using commonJS modules
  'cjs',
  // build with a hardcoded target using ES6 modules
  'esm',
];
const extensions = ['.js', '.ts', '.tsx'];

/**
 * @param {Object} param0
 * @param {string} param0.outDir - The base output directory.
 * @param {string} param0.relativeOutDir - The relative output directory for the bundle
 * @param {boolean} param0.hasLargeFiles - Whether the bundle has large files.
 * @param {boolean} param0.verbose - Whether to enable verbose logging.
 * @param {string} param0.bundle - The bundle type to process.
 * @param {string} param0.workspaceDir - The workspace directory.
 * @param {string[]} param0.ignore - Globs to be ignored by Babel.
 * @param {string} param0.packageVersion - The version of the package being built.
 * @param {string} param0.babelRuntimeVersion - The version of @babel/runtime to use.
 * @returns {Promise<void>} A promise that resolves when the bundle has been processed.
 */
async function processBundle({
  outDir: outDirBase,
  relativeOutDir,
  hasLargeFiles,
  verbose,
  bundle,
  babelRuntimeVersion,
  ignore,
  packageVersion,
  workspaceDir,
}) {
  const outFileExtension = OUT_FILE_EXTENSION[bundle];
  const outDir = path.resolve(outDirBase, relativeOutDir);

  const env = /** @type {any} */ {
    NODE_ENV: 'production',
    BABEL_ENV: {
      cjs: 'node',
      esm: 'stable',
    }[bundle],
    MUI_BUILD_VERBOSE: verbose.toString(),
    MUI_BABEL_RUNTIME_VERSION: babelRuntimeVersion,
    MUI_OUT_FILE_EXTENSION: outFileExtension,
    ...getVersionEnvVariables(packageVersion),
  };
  const babelConfigPath = path.resolve(workspaceDir, 'babel.config.js');
  const srcDir = path.resolve('src');
  const babelArgs = [
    srcDir,
    '--config-file',
    babelConfigPath,
    '--extensions',
    `"${extensions.join(',')}"`,
    '--out-dir',
    outDir,
    '--ignore',
    // Need to put these patterns in quotes otherwise they might be evaluated by the used terminal.
    `"${BASE_IGNORES.concat(ignore).join('","')}"`,
  ];

  babelArgs.push('--out-file-extension', outFileExtension);

  if (hasLargeFiles) {
    babelArgs.push('--compact false');
  }

  const command = ['pnpm babel', ...babelArgs].join(' ');

  if (verbose) {
    console.log(`running '${command}' with ${JSON.stringify(env)}`);
  }

  const { stderr, stdout } = await exec(command, { env: { ...process.env, ...env } });
  if (stderr) {
    throw new Error(`'${command}' failed with \n${stderr}`);
  }
  if (verbose) {
    console.log(stdout);
  }
  await addLicense({
    outDir,
    extension: outFileExtension,
  });
  console.log('Build completed for bundle:', bundle);
}

/**
 * Adds a license text to the output index files.
 * @param {Object} param0
 * @param {string} param0.outDir - The base output directory.
 * @param {string} param0.extension - The file extension to use.
 */
async function addLicense({ outDir, extension = '.js' }) {
  const indexFilePath = path.join(outDir, `index${extension}`);
  const fileExists = await fs.access(indexFilePath).then(
    () => true,
    () => false,
  );
  if (!fileExists) {
    console.warn(`Skipped license for ${indexFilePath}.`);
    return;
  }
  const packageData = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
  const license = `/**
 * ${packageData.name} v${packageData.version}
 *
 * @license ${packageData.license}
 * This source code is licensed under the ${packageData.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;
  const data = await fs.readFile(indexFilePath, 'utf8');
  await fs.writeFile(indexFilePath, license + data, 'utf8');
}

/**
 * Generates a package.json file with the appropriate module type.
 * @param {Object} param0
 * @param {string} param0.outDir - The base output directory.
 * @param {string} param0.relativeOutDir - The relative output directory for the bundle
 * @param {string} param0.bundle - The bundle type to process.
 */
async function generatePackageJsonWithType({ outDir, relativeOutDir, bundle }) {
  const type = {
    cjs: 'commonjs',
    esm: 'module',
  }[bundle];
  await fs.writeFile(
    path.join(outDir, relativeOutDir, 'package.json'),
    JSON.stringify({
      type,
    }),
    { encoding: 'utf8' },
  );
  console.log(`Generated package.json for ${bundle} in ${relativeOutDir} with type "${type}"`);
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build',
  describe: 'Builds the packages for publishing.',
  builder(yargs) {
    return yargs
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
      })
      .option('hasLargeFiles', {
        type: 'boolean',
        default: false,
        describe: 'Set to `true` if you know you are transpiling large files.',
      })
      .option('skipModulePackageJson', {
        type: 'boolean',
        default: false,
        describe:
          "Set to `true` if you don't want to generate a package.json file in the bundle output.",
      })
      .option('outDir', {
        default: './build',
        type: 'string',
        description: 'The build output directory.',
      })
      .option('cjsDir', {
        default: './',
        type: 'string',
        description: 'The directory to output the cjs files to.',
      })
      .option('esmDir', {
        default: './esm',
        type: 'string',
        description: 'The directory to output the esm files to.',
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging.',
      })
      .option('buildTypes', {
        type: 'boolean',
        default: false,
        description: 'Whether to build types for the package.',
      })
      .option('skipTsc', {
        type: 'boolean',
        default: false,
        description: 'Skip running TypeScript compiler (tsc) for building types.',
      })
      .option('ignore', {
        type: 'string',
        array: true,
        description: 'Extra globs to be ignored by Babel.',
        default: [],
      });
  },
  async handler(args) {
    const {
      bundle: bundles,
      hasLargeFiles,
      skipModulePackageJson,
      cjsDir,
      esmDir,
      verbose,
      ignore: extraIgnores,
      buildTypes,
      skipTsc,
    } = args;

    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
    const outDirBase = packageJson.publishConfig?.directory || 'build';

    console.log(`Selected output directory: ${outDirBase}`);

    let babelRuntimeVersion = packageJson.dependencies?.['@babel/runtime'];
    if (!babelRuntimeVersion) {
      throw new Error(
        'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
      );
    } else if (babelRuntimeVersion === 'catalog:') {
      // resolve the version from the given package
      const { stdout: listedBabelRuntime } = await $`pnpm list "@babel/runtime" --json`;
      const jsonListedDependencies = JSON.parse(listedBabelRuntime);
      babelRuntimeVersion = jsonListedDependencies[0].dependencies['@babel/runtime'].version;
    }
    const workspaceDir = await findWorkspaceDir(cwd);
    if (!workspaceDir) {
      throw new Error('Could not find workspace directory.');
    }

    bundles.forEach(async (bundle) => {
      const relativeOutDir = {
        cjs: cjsDir,
        esm: esmDir,
      }[bundle];

      await processBundle({
        babelRuntimeVersion,
        outDir: outDirBase,
        relativeOutDir,
        hasLargeFiles,
        verbose,
        packageVersion: packageJson.version,
        bundle,
        ignore: extraIgnores,
        workspaceDir,
      });
      if (!skipModulePackageJson && relativeOutDir !== './') {
        await generatePackageJsonWithType({
          outDir: outDirBase,
          relativeOutDir,
          bundle,
        });
      }
      if (buildTypes) {
        await generateTypes({
          outDir: outDirBase,
          relativeOutDir,
          bundle,
          cwd,
          skipTsc,
        });
      }
    });
  },
});

/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sep as posixSep } from 'node:path/posix';
import * as semver from 'semver';

import {
  createPackageBin,
  createPackageExports,
  getOutExtension,
  mapConcurrently,
  validatePkgJson,
} from '../utils/build.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle - The bundles to build.
 * @property {boolean} hasLargeFiles - The large files to build.
 * @property {boolean} skipBundlePackageJson - Whether to skip generating a package.json file in the /esm folder.
 * @property {boolean} verbose - Whether to enable verbose logging.
 * @property {boolean} buildTypes - Whether to build types for the package.
 * @property {boolean} skipTsc - Whether to build types for the package.
 * @property {boolean} skipBabelRuntimeCheck - Whether to skip checking for Babel runtime dependencies in the package.
 * @property {boolean} skipPackageJson - Whether to skip generating the package.json file in the bundle output.
 * @property {boolean} skipMainCheck - Whether to skip checking for main field in package.json.
 * @property {string[]} ignore - Globs to be ignored by Babel.
 * @property {string[]} [copy] - Files/Directories to be copied. Can be a glob pattern.
 * @property {boolean} [enableReactCompiler] - Whether to use the React compiler.
 * @property {boolean} [tsgo] - Whether to build types using typescript native (tsgo).
 * @property {boolean} [flat] - Builds the package in a flat structure without subdirectories for each module type.
 */

const validBundles = [
  // build for node using commonJS modules
  'cjs',
  // build with a hardcoded target using ES6 modules
  'esm',
];

/**
 * @param {Object} options
 * @param {string} options.name - The name of the package.
 * @param {string} options.version - The version of the package.
 * @param {string} options.license - The license of the package.
 * @param {boolean} options.isFlat - Whether the build is flat structure.
 * @param {'module' | 'commonjs'} options.packageType - The package.json type field.
 * @param {import('../utils/build.mjs').BundleType} options.bundle
 * @param {string} options.outputDir
 */
async function addLicense({ name, version, license, bundle, outputDir, isFlat, packageType }) {
  const outExtension = getOutExtension(bundle, { isFlat, packageType });
  const file = path.join(outputDir, `index${outExtension}`);
  if (
    !(await fs.stat(file).then(
      (stats) => stats.isFile(),
      () => false,
    ))
  ) {
    return;
  }
  const content = await fs.readFile(file, { encoding: 'utf8' });
  await fs.writeFile(
    file,
    `/**
 * ${name} v${version}
 *
 * @license ${license}
 * This source code is licensed under the ${license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
${content}`,
    { encoding: 'utf8' },
  );
  console.log(`License added to ${file}`);
}

/**
 * @param {Object} param0
 * @param {import('./packageJson').PackageJson} param0.packageJson - The package.json content.
 * @param {{type: import('../utils/build.mjs').BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} param0.addTypes - Whether to add type declarations for the package.
 * @param {boolean} param0.isFlat - Whether the build is flat structure.
 * @param {'module' | 'commonjs'} param0.packageType - The package.json type field.
 */
async function writePackageJson({
  packageJson,
  bundles,
  outputDir,
  cwd,
  addTypes = false,
  isFlat = false,
  packageType,
}) {
  delete packageJson.scripts;
  delete packageJson.publishConfig?.directory;
  delete packageJson.devDependencies;
  delete packageJson.imports;

  const resolvedPackageType = packageType || packageJson.type || 'commonjs';
  packageJson.type = resolvedPackageType;

  const originalExports = packageJson.exports;
  delete packageJson.exports;
  const originalBin = packageJson.bin;
  delete packageJson.bin;

  const {
    exports: packageExports,
    main,
    types,
  } = await createPackageExports({
    exports: originalExports,
    bundles,
    outputDir,
    cwd,
    addTypes,
    isFlat,
    packageType: resolvedPackageType,
  });

  packageJson.exports = packageExports;
  if (main) {
    packageJson.main = main;
  }
  if (types) {
    packageJson.types = types;
  }

  const bin = await createPackageBin({
    bin: originalBin,
    bundles,
    cwd,
    isFlat,
    packageType: resolvedPackageType,
  });
  if (bin) {
    packageJson.bin = bin;
  }

  await fs.writeFile(
    path.join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf-8',
  );
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'build',
  describe: 'Builds the package for publishing.',
  builder(yargs) {
    return yargs
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
        default: ['esm', 'cjs'],
      })
      .option('hasLargeFiles', {
        type: 'boolean',
        default: false,
        describe: 'Set to `true` if you know you are transpiling large files.',
      })
      .option('skipBundlePackageJson', {
        type: 'boolean',
        default: false,
        describe:
          "Set to `true` if you don't want to generate a package.json file in the bundle output.",
      })
      .option('buildTypes', {
        type: 'boolean',
        default: true,
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
      })
      .option('skipBabelRuntimeCheck', {
        type: 'boolean',
        default: false,
        description: 'Skip checking for Babel runtime dependencies in the package.',
      })
      .option('skipPackageJson', {
        type: 'boolean',
        default: false,
        description: 'Skip generating the package.json file in the bundle output.',
      })
      .option('skipMainCheck', {
        // Currently added only to support @mui/icons-material. To be removed separately.
        type: 'boolean',
        default: false,
        description: 'Skip checking for main field in package.json.',
      })
      .option('copy', {
        type: 'string',
        array: true,
        description:
          'Files/Directories to be copied to the output directory. Can be a glob pattern.',
        default: [],
      })
      .option('enableReactCompiler', {
        type: 'boolean',
        default: false,
        description: 'Whether to use the React compiler.',
      })
      .option('tsgo', {
        type: 'boolean',
        default: process.env.MUI_USE_TSGO,
        description:
          'Uses tsgo cli instead of tsc for type generation. Can also be set via env var "MUI_USE_TSGO"',
      })
      .option('flat', {
        type: 'boolean',
        default: process.env.MUI_BUILD_FLAT === '1',
        description:
          'Builds the package in a flat structure without subdirectories for each module type.',
      });
  },
  async handler(args) {
    const {
      bundle: bundles,
      hasLargeFiles,
      skipBundlePackageJson,
      verbose = false,
      ignore: extraIgnores,
      buildTypes,
      skipTsc,
      skipBabelRuntimeCheck = false,
      skipPackageJson = false,
      enableReactCompiler = false,
      tsgo: useTsgo = false,
    } = args;

    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
    validatePkgJson(packageJson, { skipMainCheck: args.skipMainCheck, enableReactCompiler });

    const buildDirBase = /** @type {string} */ (packageJson.publishConfig?.directory);
    const buildDir = path.join(cwd, buildDirBase);
    const packageType = packageJson.type === 'module' ? 'module' : 'commonjs';

    console.log(`Selected output directory: "${buildDirBase}"`);
    if (args.flat) {
      console.log('Building package in flat structure.');
    }

    await fs.rm(buildDir, { recursive: true, force: true });

    let babelRuntimeVersion = packageJson.dependencies['@babel/runtime'];
    if (babelRuntimeVersion === 'catalog:') {
      // resolve the version from the given package
      // outputs the pnpm-workspace.yaml config as json
      const { stdout: configStdout } = await $`pnpm config list --json`;
      const pnpmWorkspaceConfig = JSON.parse(configStdout);
      babelRuntimeVersion = pnpmWorkspaceConfig.catalog['@babel/runtime'];
    }

    if (!babelRuntimeVersion && !skipBabelRuntimeCheck) {
      throw new Error(
        'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
      );
    }

    if (!bundles.length) {
      console.error('No bundles specified. Use --bundle to specify which bundles to build.');
      return;
    }

    const { build: babelBuild, cjsCopy } = await import('../utils/babel.mjs');
    const relativeOutDirs = !args.flat
      ? {
          cjs: '.',
          esm: 'esm',
        }
      : {
          cjs: '.',
          esm: '.',
        };
    const sourceDir = path.join(cwd, 'src');
    const reactVersion =
      semver.minVersion(packageJson.peerDependencies?.react || '')?.version ?? 'latest';

    if (enableReactCompiler) {
      const mode = process.env.MUI_REACT_COMPILER_MODE ?? 'opt-in';
      console.log(
        `[feature] Building with React compiler enabled. The compiler mode is "${mode}" right now.${mode === 'opt-in' ? ' Use explicit "use memo" directives in your components to enable the React compiler for them.' : ''}`,
      );
    }

    // js build start
    await Promise.all(
      bundles.map(async (bundle) => {
        const outExtension = getOutExtension(bundle, {
          isFlat: !!args.flat,
          isType: false,
          packageType,
        });
        const relativeOutDir = relativeOutDirs[bundle];
        const outputDir = path.join(buildDir, relativeOutDir);
        await fs.mkdir(outputDir, { recursive: true });

        const promises = [];

        promises.push(
          babelBuild({
            cwd,
            sourceDir,
            outDir: outputDir,
            babelRuntimeVersion,
            hasLargeFiles,
            bundle,
            verbose,
            optimizeClsx:
              packageJson.dependencies.clsx !== undefined ||
              packageJson.dependencies.classnames !== undefined,
            removePropTypes: packageJson.dependencies['prop-types'] !== undefined,
            pkgVersion: packageJson.version,
            ignores: extraIgnores,
            outExtension,
            reactCompiler: enableReactCompiler
              ? {
                  reactVersion: reactVersion || 'latest',
                }
              : undefined,
          }),
        );

        if (buildDir !== outputDir && !skipBundlePackageJson && !args.flat) {
          // @TODO - Not needed if the output extension is .mjs. Remove this before PR merge.
          promises.push(
            fs.writeFile(
              path.join(outputDir, 'package.json'),
              JSON.stringify({
                type: bundle === 'esm' ? 'module' : 'commonjs',
                sideEffects: packageJson.sideEffects ?? false,
              }),
            ),
          );
        }

        if (!args.flat) {
          // cjs for reexporting from commons only modules.
          // @NOTE: If we need to rely more on this we can think about setting up
          // a separate commonjs => commonjs build for .cjs files to .cjs
          // `--extensions-.cjs --out-file-extension .cjs`
          promises.push(cjsCopy({ from: sourceDir, to: outputDir }));
        }

        await Promise.all(promises);
        await addLicense({
          bundle,
          license: packageJson.license,
          name: packageJson.name,
          version: packageJson.version,
          outputDir,
          isFlat: !!args.flat,
          packageType,
        });
      }),
    );

    if (args.flat) {
      await cjsCopy({ from: sourceDir, to: buildDir });
    }
    // js build end

    if (buildTypes) {
      const tsMod = await import('../utils/typescript.mjs');
      /**
       * @type {{type: import('../utils/build.mjs').BundleType, dir: string}[]};
       */
      const bundleMap = bundles.map((type) => ({
        type,
        dir: relativeOutDirs[type],
      }));

      await tsMod.createTypes({
        bundles: bundleMap,
        srcDir: sourceDir,
        cwd,
        skipTsc,
        isFlat: !!args.flat,
        buildDir,
        useTsgo,
        packageType,
        verbose: args.verbose,
      });
    }
    if (skipPackageJson) {
      console.log('Skipping package.json generation in the output directory.');
      return;
    }

    await writePackageJson({
      cwd,
      packageJson,
      bundles: bundles.map((type) => ({
        type,
        dir: relativeOutDirs[type],
      })),
      outputDir: buildDir,
      addTypes: buildTypes,
      isFlat: !!args.flat,
      packageType,
    });

    await copyHandler({
      cwd,
      globs: args.copy ?? [],
      buildDir,
      verbose: args.verbose,
    });
  },
});

/**
 * @param {Object} param0
 * @param {string} param0.cwd - The current working directory.
 * @param {string[]} [param0.globs=[]] - Extra files to copy, can be specified as `source:target` pairs or just `source`.
 * @param {string} param0.buildDir - The build directory to copy to.
 * @param {boolean} [param0.verbose=false] - Whether to suppress output.
 * @returns {Promise<void>}
 */
async function copyHandler({ cwd, globs = [], buildDir, verbose = false }) {
  /**
   * @type {(string|{targetPath: string; sourcePath: string})[]}
   */
  const defaultFiles = [];
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Workspace directory not found');
  }

  const localOrRootFiles = [
    [path.join(cwd, 'README.md'), path.join(workspaceDir, 'README.md')],
    [path.join(cwd, 'LICENSE'), path.join(workspaceDir, 'LICENSE')],
    [path.join(cwd, 'CHANGELOG.md'), path.join(workspaceDir, 'CHANGELOG.md')],
  ];
  await Promise.all(
    localOrRootFiles.map(async (filesToCopy) => {
      for (const file of filesToCopy) {
        if (
          // eslint-disable-next-line no-await-in-loop
          await fs.stat(file).then(
            () => true,
            () => false,
          )
        ) {
          defaultFiles.push(file);
          break;
        }
      }
    }),
  );

  if (globs.length) {
    const res = globs.map((globPattern) => {
      const [pattern, baseDir] = globPattern.split(':');
      return { pattern, baseDir };
    });
    /**
     * Avoids redundant globby calls for the same pattern.
     *
     * @type {Map<string, Promise<string[]>>}
     */
    const globToResMap = new Map();

    const result = await Promise.all(
      res.map(async ({ pattern, baseDir }) => {
        if (!globToResMap.has(pattern)) {
          const promise = globby(pattern, { cwd });
          globToResMap.set(pattern, promise);
        }
        const files = await globToResMap.get(pattern);
        return { files: files ?? [], baseDir };
      }),
    );
    globToResMap.clear();

    result.forEach(({ files, baseDir }) => {
      files.forEach((file) => {
        const sourcePath = path.resolve(cwd, file);
        // Use posix separator for the relative paths. So devs can only specify globs with `/` even on Windows.
        const pathSegments = file.split(posixSep);
        const relativePath =
          // Use index 2 (when required) since users can also specify paths like `./src/index.js`
          pathSegments.slice(pathSegments[0] === '.' ? 2 : 1).join(posixSep) || file;
        const targetPath = baseDir
          ? path.resolve(buildDir, baseDir, relativePath)
          : path.resolve(buildDir, relativePath);
        defaultFiles.push({ sourcePath, targetPath });
      });
    });
  }

  if (!defaultFiles.length) {
    if (verbose) {
      console.log('⓿ No files to copy.');
    }
  }
  await mapConcurrently(
    defaultFiles,
    async (file) => {
      if (typeof file === 'string') {
        const sourcePath = file;
        const fileName = path.basename(file);
        const targetPath = path.join(buildDir, fileName);
        await recursiveCopy({ source: sourcePath, target: targetPath, verbose });
      } else {
        await fs.mkdir(path.dirname(file.targetPath), { recursive: true });
        await recursiveCopy({ source: file.sourcePath, target: file.targetPath, verbose });
      }
    },
    20,
  );
  console.log(`📋 Copied ${defaultFiles.length} files.`);
}

/**
 * Recursively copies files and directories from a source path to a target path.
 *
 * @async
 * @param {Object} options - The options for copying files.
 * @param {string} options.source - The source path to copy from.
 * @param {string} options.target - The target path to copy to.
 * @param {boolean} [options.verbose=true] - If true, suppresses console output.
 * @returns {Promise<boolean>} Resolves when the copy operation is complete.
 * @throws {Error} Throws if an error occurs other than the source not existing.
 */
async function recursiveCopy({ source, target, verbose = true }) {
  try {
    await fs.cp(source, target, { recursive: true });
    if (verbose) {
      console.log(`Copied ${source} to ${target}`);
    }
    return true;
  } catch (err) {
    if (/** @type {{ code: string }} */ (err).code !== 'ENOENT') {
      throw err;
    }
    if (verbose) {
      console.warn(`Source does not exist: ${source}`);
    }
    throw err;
  }
}

/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';

import {
  createPackageBin,
  createPackageExports,
  createPackageImports,
  getOutExtension,
  validatePkgJson,
} from '../utils/build.mjs';
import { copyFiles } from '../utils/copyFiles.mjs';
import { readPnpmConfig } from '../utils/pnpm.mjs';

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
 * @property {boolean} [tsgo] - Whether to build types using the native TypeScript compiler.
 * @property {boolean} [flat] - Deprecated no-op; flat builds are always used.
 * @property {boolean} expand - Whether to enumerate glob patterns in exports/imports into concrete entries.
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
 * @param {'module' | 'commonjs'} options.packageType - The package.json type field.
 * @param {import('../utils/build.mjs').BundleType} options.bundle
 * @param {string} options.outputDir
 */
async function addLicense({ name, version, license, bundle, outputDir, packageType }) {
  const outExtension = getOutExtension(bundle, { packageType });
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
 * @param {import('../utils/build.mjs').BundleType[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} param0.addTypes - Whether to add type declarations for the package.
 * @param {boolean} [param0.expand] - Whether to enumerate glob patterns into concrete entries.
 * @param {'module' | 'commonjs'} param0.packageType - The package.json type field.
 */
async function writePackageJson({
  packageJson,
  bundles,
  outputDir,
  cwd,
  addTypes = false,
  expand = true,
  packageType,
}) {
  delete packageJson.scripts;
  delete packageJson.publishConfig?.directory;
  delete packageJson.devDependencies;

  const resolvedPackageType = packageType || packageJson.type || 'commonjs';
  packageJson.type = resolvedPackageType;

  const originalExports = packageJson.exports;
  delete packageJson.exports;
  const originalImports = packageJson.imports;
  delete packageJson.imports;
  const originalBin = packageJson.bin;
  delete packageJson.bin;

  const [{ exports: packageExports, main, types }, packageImports] = await Promise.all([
    createPackageExports(originalExports, {
      bundles,
      outputDir,
      cwd,
      addTypes,
      expand,
      packageType: resolvedPackageType,
    }),
    originalImports
      ? createPackageImports(originalImports, {
          bundles,
          cwd,
          outputDir,
          addTypes,
          expand,
          packageType: resolvedPackageType,
        })
      : Promise.resolve(undefined),
  ]);

  packageJson.exports = packageExports;
  if (packageImports) {
    packageJson.imports = packageImports;
  }
  if (main) {
    packageJson.main = main;
  }
  if (types) {
    packageJson.types = types;
  }

  const bin = await createPackageBin(originalBin, {
    bundles,
    cwd,
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
        default: false,
        description:
          'Use the native TypeScript compiler instead of the TS6 JS compiler for type generation',
      })
      .option('flat', {
        type: 'boolean',
        deprecated:
          'Flat builds are now always used; this flag is a no-op and will be removed in a future release.',
        default: true,
        description:
          '@deprecated Flat builds are always used now. The package is always built in a flat structure without subdirectories for each module type.',
      })
      .option('expand', {
        type: 'boolean',
        default: true,
        description:
          'Enumerate glob patterns in the package.json "exports"/"imports" into concrete entries. Use --no-expand to keep them as Node runtime subpath patterns.',
      });
  },
  async handler(args) {
    const {
      bundle: bundles,
      hasLargeFiles,
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

    await fs.rm(buildDir, { recursive: true, force: true });

    let babelRuntimeVersion = packageJson.dependencies['@babel/runtime'];
    if (babelRuntimeVersion === 'catalog:') {
      // resolve the version from the given package
      // outputs the pnpm-workspace.yaml config as json
      const pnpmWorkspaceConfig = await readPnpmConfig();
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
          isType: false,
          packageType,
        });
        await fs.mkdir(buildDir, { recursive: true });

        const promises = [];

        promises.push(
          babelBuild({
            cwd,
            sourceDir,
            outDir: buildDir,
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

        await Promise.all(promises);
        await addLicense({
          bundle,
          license: packageJson.license,
          name: packageJson.name,
          version: packageJson.version,
          outputDir: buildDir,
          packageType,
        });
      }),
    );

    await cjsCopy({ from: sourceDir, to: buildDir });
    // js build end

    if (buildTypes) {
      const tsMod = await import('../utils/typescript.mjs');
      await tsMod.createTypes({
        bundles,
        srcDir: sourceDir,
        cwd,
        skipTsc,
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
      bundles,
      outputDir: buildDir,
      addTypes: buildTypes,
      expand: args.expand,
      packageType,
    });

    await copyFiles({
      cwd,
      globs: args.copy ?? [],
      buildDir,
      verbose: args.verbose,
    });
  },
});

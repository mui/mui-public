/* eslint-disable no-console */
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';

import { getOutExtension, isMjsBuild, validatePkgJson } from '../utils/build.mjs';
import { copyFiles } from '../utils/copyFiles.mjs';

/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle - The bundles to build.
 * @property {boolean} hasLargeFiles - The large files to build.
 * @property {boolean} skipBundlePackageJson - Whether to skip generating a package.json file in the /esm folder.
 * @property {string} cjsOutDir - The directory to copy the cjs files to.
 * @property {boolean} verbose - Whether to enable verbose logging.
 * @property {boolean} buildTypes - Whether to build types for the package.
 * @property {boolean} skipTsc - Whether to build types for the package.
 * @property {boolean} skipBabelRuntimeCheck - Whether to skip checking for Babel runtime dependencies in the package.
 * @property {boolean} skipPackageJson - Whether to skip generating the package.json file in the bundle output.
 * @property {boolean} skipMainCheck - Whether to skip checking for main field in package.json.
 * @property {string[]} ignore - Globs to be ignored by Babel.
 * @property {string[]} [copy] - Files/Directories to be copied. Can be a glob pattern.
 * @property {boolean} [enableReactCompiler] - Whether to use the React compiler.
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
 * @param {import('../utils/build.mjs').BundleType} options.bundle
 * @param {string} options.outputDir
 */
async function addLicense({ name, version, license, bundle, outputDir }) {
  const outExtension = getOutExtension(bundle);
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
 * @param {NonNullable<import('./packageJson').PackageJson.Exports>} param0.importPath
 * @param {string} param0.key
 * @param {string} param0.cwd
 * @param {string} param0.dir
 * @param {string} param0.type
 * @param {import('./packageJson').PackageJson.ExportConditions} param0.newExports
 * @param {string} param0.typeOutExtension
 * @param {string} param0.outExtension
 * @param {boolean} param0.addTypes
 * @returns {Promise<void>}
 */
async function createExportsFor({
  importPath,
  key,
  cwd,
  dir,
  type,
  newExports,
  typeOutExtension,
  outExtension,
  addTypes,
}) {
  if (Array.isArray(importPath)) {
    throw new Error(
      `Array form of package.json exports is not supported yet. Found in export "${key}".`,
    );
  }

  let srcPath = typeof importPath === 'string' ? importPath : importPath['mui-src'];
  const rest = typeof importPath === 'string' ? {} : { ...importPath };
  delete rest['mui-src'];

  if (typeof srcPath !== 'string') {
    throw new Error(
      `Unsupported export for "${key}". Only a string or an object with "mui-src" field is supported for now.`,
    );
  }

  const exportFileExists = srcPath.includes('*')
    ? true
    : await fs.stat(path.join(cwd, srcPath)).then(
        (stats) => stats.isFile() || stats.isDirectory(),
        () => false,
      );
  if (!exportFileExists) {
    throw new Error(
      `The import path "${srcPath}" for export "${key}" does not exist in the package. Either remove the export or add the file/folder to the package.`,
    );
  }
  srcPath = srcPath.replace(/\.\/src\//, `./${dir === '.' ? '' : `${dir}/`}`);
  const ext = path.extname(srcPath);

  if (ext === '.css') {
    newExports[key] = srcPath;
    return;
  }

  if (typeof newExports[key] === 'string' || Array.isArray(newExports[key])) {
    throw new Error(`The export "${key}" is already defined as a string or Array.`);
  }

  newExports[key] ??= {};
  newExports[key][type === 'cjs' ? 'require' : 'import'] = {
    ...rest,
    ...(addTypes ? { types: srcPath.replace(ext, typeOutExtension) } : {}),
    default: srcPath.replace(ext, outExtension),
  };
}

/**
 * @param {Object} param0
 * @param {import('./packageJson').PackageJson} param0.packageJson - The package.json content.
 * @param {{type: import('../utils/build.mjs').BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} param0.addTypes - Whether to add type declarations for the package.
 */
async function writePackageJson({ packageJson, bundles, outputDir, cwd, addTypes = false }) {
  delete packageJson.scripts;
  delete packageJson.publishConfig?.directory;
  delete packageJson.devDependencies;
  delete packageJson.imports;

  packageJson.type = packageJson.type || 'commonjs';

  /**
   * @type {import('./packageJson').PackageJson.ExportConditions}
   */
  const originalExports =
    typeof packageJson.exports === 'string' || Array.isArray(packageJson.exports)
      ? { '.': packageJson.exports }
      : packageJson.exports || {};
  delete packageJson.exports;
  /**
   * @type {import('./packageJson').PackageJson.ExportConditions}
   */
  const newExports = {
    './package.json': './package.json',
  };

  await Promise.all(
    bundles.map(async ({ type, dir }) => {
      const outExtension = getOutExtension(type);
      const typeOutExtension = getOutExtension(type, true);
      const indexFileExists = await fs.stat(path.join(outputDir, dir, `index${outExtension}`)).then(
        (stats) => stats.isFile(),
        () => false,
      );
      const typeFileExists =
        addTypes &&
        (await fs.stat(path.join(outputDir, dir, `index${typeOutExtension}`)).then(
          (stats) => stats.isFile(),
          () => false,
        ));
      const dirPrefix = dir === '.' ? '' : `${dir}/`;
      const exportDir = `./${dirPrefix}index${outExtension}`;
      const typeExportDir = `./${dirPrefix}index${typeOutExtension}`;

      if (indexFileExists) {
        // skip `packageJson.module` to support parcel and some older bundlers
        if (type === 'cjs') {
          packageJson.main = exportDir;
        }

        if (typeof newExports['.'] === 'string' || Array.isArray(newExports['.'])) {
          throw new Error(`The export "." is already defined as a string or Array.`);
        }

        newExports['.'] ??= {};
        newExports['.'][type === 'cjs' ? 'require' : 'import'] = {
          ...(typeFileExists ? { types: typeExportDir } : {}),
          default: exportDir,
        };
      }
      if (typeFileExists && type === 'cjs') {
        packageJson.types = typeExportDir;
      }
      const exportKeys = Object.keys(originalExports);
      // need to maintain the order of exports
      for (const key of exportKeys) {
        const importPath = originalExports[key];
        if (!importPath) {
          newExports[key] = null;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await createExportsFor({
          importPath,
          key,
          cwd,
          dir,
          type,
          newExports,
          typeOutExtension,
          outExtension,
          addTypes,
        });
      }
    }),
  );
  bundles.forEach(({ dir }) => {
    if (dir !== '.') {
      newExports[`./${dir}`] = null;
    }
  });

  // default condition should come last
  Object.keys(newExports).forEach((key) => {
    const exportVal = newExports[key];
    if (Array.isArray(exportVal)) {
      throw new Error(
        `Array form of package.json exports is not supported yet. Found in export "${key}".`,
      );
    }
    if (exportVal && typeof exportVal === 'object' && (exportVal.import || exportVal.require)) {
      const defaultExport = exportVal.import || exportVal.require;
      if (exportVal.import) {
        delete exportVal.import;
      } else if (exportVal.require) {
        delete exportVal.require;
      }
      exportVal.default = defaultExport;
    }
  });

  packageJson.exports = newExports;

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
      .option('cjsOutDir', {
        default: '.',
        type: 'string',
        description: 'The directory to output the cjs files to.',
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging.',
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
      });
  },
  async handler(args) {
    const {
      bundle: bundles,
      hasLargeFiles,
      skipBundlePackageJson,
      cjsOutDir = '.',
      verbose = false,
      ignore: extraIgnores,
      buildTypes,
      skipTsc,
      skipBabelRuntimeCheck = false,
      skipPackageJson = false,
      enableReactCompiler = false,
    } = args;

    const cwd = process.cwd();
    performance.mark('build-start');
    const pkgJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
    validatePkgJson(packageJson, { skipMainCheck: args.skipMainCheck, enableReactCompiler });

    const buildDirBase = /** @type {string} */ (packageJson.publishConfig?.directory);
    const buildDir = path.join(cwd, buildDirBase);

    console.log(`Selected output directory: "${buildDirBase}"`);

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

    const babelMod = await import('../utils/babel.mjs');
    const relativeOutDirs = {
      cjs: cjsOutDir,
      esm: 'esm',
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
        const outExtension = getOutExtension(bundle);
        const relativeOutDir = relativeOutDirs[bundle];
        const outputDir = path.join(buildDir, relativeOutDir);
        await fs.mkdir(outputDir, { recursive: true });

        const promises = [];

        promises.push(
          babelMod.babelBuild({
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

        if (buildDir !== outputDir && !skipBundlePackageJson && !isMjsBuild) {
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

        await Promise.all(promises);
        await addLicense({
          bundle,
          license: packageJson.license,
          name: packageJson.name,
          version: packageJson.version,
          outputDir,
        });
      }),
    );
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
        isMjsBuild,
        buildDir,
      });
    }
    if (skipPackageJson) {
      console.log('Skipping package.json generation in the output directory.');
      return;
    }

    const normalizedCjsOutDir = cjsOutDir === '.' || cjsOutDir === './' ? '.' : cjsOutDir;
    await writePackageJson({
      cwd,
      packageJson,
      bundles: bundles.map((type) => ({
        type,
        dir: type === 'esm' ? 'esm' : normalizedCjsOutDir || '.',
      })),
      outputDir: buildDir,
      addTypes: buildTypes,
    });

    await copyFiles({
      cwd,
      globs: args.copy ?? [],
      buildDir,
      verbose: args.verbose,
    });
  },
});

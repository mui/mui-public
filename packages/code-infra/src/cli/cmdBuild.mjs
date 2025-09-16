/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import { globby } from 'globby';
import set from 'lodash-es/set.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sep as posixSep } from 'node:path/posix';

import { getOutExtension, isMjsBuild, mapConcurrently, validatePkgJson } from '../utils/build.mjs';
import { shimPackageExports } from './packageExports.mjs';

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
 * @param {string | Record<string, string>} param0.importPath
 * @param {string} param0.key
 * @param {string} param0.cwd
 * @param {string} param0.dir
 * @param {string} param0.type
 * @param {Object} param0.newExports
 * @param {string} param0.typeOutExtension
 * @param {string} param0.outExtension
 * @param {boolean} param0.addTypes
 * @returns {Promise<{path: string[], importPath: string | Record<string, string | undefined>}>}
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
  let srcPath = typeof importPath === 'string' ? importPath : importPath['mui-src'];
  const rest = typeof importPath === 'string' ? {} : { ...importPath };
  delete rest['mui-src'];

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
    set(newExports, [key], srcPath);
    return {
      path: [key],
      importPath: srcPath,
    };
  }
  return {
    path: [key, type === 'cjs' ? 'require' : 'import'],
    importPath: {
      ...rest,
      types: addTypes ? srcPath.replace(ext, typeOutExtension) : undefined,
      default: srcPath.replace(ext, outExtension),
    },
  };
}

/**
 * @param {Object} param0
 * @param {any} param0.packageJson - The package.json content.
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
   * @type {Record<string, string | Record<string, string> | null>}
   */
  const originalExports = packageJson.exports || {};
  delete packageJson.exports;
  /**
   * @type {Record<string, string | Record<string, string> | null>}
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
        set(newExports, ['.', type === 'cjs' ? 'require' : 'import'], {
          types: typeFileExists ? typeExportDir : undefined,
          default: exportDir,
        });
      }
      if (typeFileExists && type === 'cjs') {
        packageJson.types = typeExportDir;
      }
      const exportKeys = Object.keys(originalExports);
      // need to maintain the order of exports
      for (const key of exportKeys) {
        const importPath = originalExports[key];
        if (!importPath) {
          set(newExports, [key], null);
          return;
        }
        // eslint-disable-next-line no-await-in-loop
        const res = await createExportsFor({
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
        set(newExports, res.path, res.importPath);
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

  await Promise.all([
    fs.writeFile(
      path.join(outputDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf-8',
    ),
    shimPackageExports(outputDir, packageJson.exports, {
      sideEffects: packageJson.sideEffects ?? false,
    }),
  ]);
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
    } = args;

    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
    validatePkgJson(packageJson, { skipMainCheck: args.skipMainCheck });

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

    const babelMod = await import('./babel.mjs');
    const relativeOutDirs = {
      cjs: cjsOutDir,
      esm: 'esm',
    };
    const sourceDir = path.join(cwd, 'src');

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
      const tsMod = await import('./typescript.mjs');
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

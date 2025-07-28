/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';
import deepMerge from 'lodash-es/merge.js';
import set from 'lodash-es/set.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const isMjsBuild = !!process.env.MUI_EXPERIMENTAL_MJS;

/**
 * @typedef {Object} Args
 * @property {('cjs' | 'esm')[]} bundle - The bundles to build.
 * @property {boolean} hasLargeFiles - The large files to build.
 * @property {boolean} skipModulePackageJson - Whether to skip generating a package.json file in the /esm folder.
 * @property {string} cjsOutDir - The directory to copy the cjs files to.
 * @property {boolean} verbose - Whether to enable verbose logging.
 * @property {boolean} buildTypes - Whether to build types for the package.
 * @property {boolean} skipTsc - Whether to build types for the package.
 * @property {boolean} optimizeClsx - Whether to enable clsx call optimization transform.
 * @property {boolean} skipCatchAllExports - Whether to skip adding catch-all exports for the package.
 * @property {boolean} skipBabelRuntimeCheck - Whether to skip checking for Babel runtime dependencies in the package.
 * @property {string[]} ignore - Globs to be ignored by Babel.
 */

/**
 * @typedef {Object} PkgJson
 * @property {Object} [code-infra] - Code infra specific configuration.
 * @property {import('./babel.mjs').BuildConfig} [code-infra.build] - Code infra specific configuration.
 */

const validBundles = [
  // build for node using commonJS modules
  'cjs',
  // build with a hardcoded target using ES6 modules
  'esm',
];

/**
 * @param {import('./babel.mjs').BundleType} bundle
 */
function getOutExtension(bundle, isType = false) {
  if (isType) {
    if (!isMjsBuild) {
      return '.d.ts';
    }
    return bundle === 'esm' ? '.d.mts' : '.d.ts';
  }
  if (!isMjsBuild) {
    return '.js';
  }
  return bundle === 'esm' ? '.mjs' : '.js';
}

/**
 * @param {Object} options
 * @param {string} options.name - The name of the package.
 * @param {string} options.version - The version of the package.
 * @param {string} options.license - The license of the package.
 * @param {import('./babel.mjs').BundleType} options.bundle
 * @param {string} options.outputDir
 */
async function addLicense({ name, version, license, bundle, outputDir }) {
  // @TODO - Implement license addition logic
  // This function should add the license file to the output directory.
  // For now, it's a placeholder.
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
 * @param {any} param0.packageJson - The package.json content.
 * @param {{type: import('./babel.mjs').BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} param0.skipCatchAllExports - Whether to skip adding catch-all exports for the package.
 */
async function writePackageJson({
  packageJson,
  bundles,
  outputDir,
  cwd,
  skipCatchAllExports = false,
}) {
  delete packageJson.scripts;
  delete packageJson.publishConfig?.directory;
  delete packageJson.devDependencies;

  packageJson.type = packageJson.type || 'commonjs';

  /**
   * @type {Record<string, string | Record<string, string | Record<string, string | undefined>> | null>}
   */
  const originalExports = packageJson.exports || {};
  delete packageJson.exports;
  /**
   * @type {Record<string, string | Record<string, string | Record<string, string | undefined>> | null>}
   */
  const newExports = {
    './package.json': './package.json',
  };

  await Promise.all(
    bundles.map(async ({ type, dir }) => {
      const outExtension = getOutExtension(type);
      const fileExists = await fs
        .stat(path.join(outputDir, dir, `index${getOutExtension(type)}`))
        .then(
          (stats) => stats.isFile(),
          () => false,
        );
      const typeOutExtension = getOutExtension(type, true);
      const typeFileExists = await fs
        .stat(path.join(outputDir, dir, `index${typeOutExtension}`))
        .then(
          (stats) => stats.isFile(),
          () => false,
        );
      const exportDir = `./${dir === '.' ? '' : `${dir}/`}index${outExtension}`;
      const typeExportDir = `./${dir === '.' ? '' : `${dir}/`}index${typeOutExtension}`;

      if (fileExists) {
        packageJson[type === 'cjs' ? 'main' : 'module'] = exportDir;
        const exportObj = {
          types: typeFileExists ? typeExportDir : undefined,
          default: exportDir,
        };
        newExports['.'] = newExports['.'] || {};
        set(newExports, ['.', type === 'cjs' ? 'require' : 'import'], exportObj);
      }
      if (typeFileExists && type === 'cjs') {
        packageJson.types = typeExportDir;
      }

      await Promise.all(
        Object.keys(originalExports).map(async (key) => {
          if (!originalExports[key]) {
            newExports[key] = null;
          } else {
            let importPath = originalExports[key];
            if (typeof importPath === 'string') {
              const exportFileExists = !importPath.includes('*')
                ? await fs.stat(path.join(cwd, importPath)).then(
                    (stats) => stats.isFile(),
                    () => false,
                  )
                : true;
              if (!exportFileExists) {
                throw new Error(
                  `The import path "${importPath}" for export "${key}" does not exist in the package. Either remove the export or add the file to the package.`,
                );
              }
              importPath = importPath.replace(/\.\/src\//, `./${dir === '.' ? '' : `${dir}/`}`);
              const ext = path.extname(importPath);

              if (ext === '.css') {
                set(newExports, [key], importPath);
              } else {
                set(newExports, [key, type === 'cjs' ? 'require' : 'import'], {
                  types: importPath.replace(ext, typeOutExtension),
                  default: importPath.replace(ext, outExtension),
                });
              }
            }
          }
        }),
      );
      if (!skipCatchAllExports) {
        const exportsObj = {
          types: `./${dir === '.' ? '' : `${dir}/`}*/index${typeOutExtension}`,
          default: `./${dir === '.' ? '' : `${dir}/`}*/index${outExtension}`,
        };
        set(newExports, ['./*', type === 'cjs' ? 'require' : 'import'], exportsObj);
      }
    }),
  );
  bundles.forEach(({ dir }) => {
    if (dir !== '.') {
      newExports[`./${dir}`] = null;
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
      .option('cjsOutDir', {
        default: 'cjs',
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
      .option('optimizeClsx', {
        type: 'boolean',
        default: false,
        description: 'Enable clsx call optimization transform.',
      })
      .option('skipCatchAllExports', {
        type: 'boolean',
        default: false,
        description:
          'Skip adding catch-all exports for the package. Useful for newer packages with explicit exports.',
      })
      .option('skipBabelRuntimeCheck', {
        type: 'boolean',
        default: false,
        description: 'Skip checking for Babel runtime dependencies in the package.',
      });
  },
  async handler(args) {
    const {
      bundle: bundles,
      hasLargeFiles,
      optimizeClsx,
      skipModulePackageJson,
      cjsOutDir = 'cjs',
      verbose = false,
      ignore: extraIgnores,
      buildTypes,
      skipTsc,
      skipCatchAllExports = false,
      skipBabelRuntimeCheck = false,
    } = args;

    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
    const buildDirBase = packageJson.publishConfig?.directory || 'build';
    const buildDir = path.join(cwd, buildDirBase);

    console.log(`Selected output directory: ${buildDirBase}`);

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
    const workspaceDir = await findWorkspaceDir(cwd);

    /**
     * @type {import('./babel.mjs').BuildConfig | undefined}
     */
    let buildConfig;

    if (workspaceDir) {
      buildConfig = /** @type {PkgJson} */ (
        JSON.parse(await fs.readFile(path.join(workspaceDir, 'package.json'), 'utf8'))
      )?.['code-infra']?.build;
      if (buildConfig?.errorCodesPath) {
        buildConfig.errorCodesPath = path.join(workspaceDir, buildConfig.errorCodesPath);
      }
    }

    const localBuildConfig = /** @type {PkgJson} */ (packageJson)?.['code-infra']?.build;
    if (localBuildConfig?.errorCodesPath) {
      localBuildConfig.errorCodesPath = path.join(cwd, localBuildConfig.errorCodesPath);
    }
    if (localBuildConfig) {
      buildConfig = deepMerge(buildConfig, localBuildConfig);
    }

    buildConfig = deepMerge({ cjsOutDir }, buildConfig);

    await Promise.all(
      bundles.map(async (bundle) => {
        const outExtension = getOutExtension(bundle);
        const relativeOutDir = {
          cjs: buildConfig.cjsOutDir ?? 'cjs',
          esm: 'esm',
        }[bundle];
        const outputDir = path.join(buildDir, relativeOutDir);
        const sourceDir = path.join(cwd, 'src');
        await fs.mkdir(outputDir, { recursive: true });

        await babelMod.babelBuild({
          sourceDir,
          outDir: outputDir,
          babelRuntimeVersion,
          hasLargeFiles,
          bundle,
          verbose,
          optimizeClsx,
          buildConfig,
          pkgVersion: packageJson.version,
          ignores: extraIgnores,
          outExtension,
        });

        const promises = [];

        if (buildDir !== outputDir && !skipModulePackageJson && !isMjsBuild) {
          // @TODO - Not needed if the output extension is .mjs. Remove this before PR merge.
          promises.push(
            fs.writeFile(
              path.join(outputDir, 'package.json'),
              JSON.stringify({
                type: bundle === 'esm' ? 'module' : 'commonjs',
              }),
            ),
          );
        }

        if (buildTypes) {
          const tsMod = await import('./typescript.mjs');
          promises.push(
            tsMod.generateTypes({
              srcDir: sourceDir,
              outDir: outputDir,
              cwd,
              skipTsc,
              bundle,
              isMjsBuild,
            }),
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
    const normalizedCjsOutDir =
      buildConfig.cjsOutDir === '.' || buildConfig.cjsOutDir === './' ? '.' : buildConfig.cjsOutDir;
    await writePackageJson({
      cwd,
      packageJson,
      bundles: bundles.map((type) => ({
        type,
        dir: type === 'esm' ? 'esm' : normalizedCjsOutDir || 'cjs',
      })),
      outputDir: buildDir,
      skipCatchAllExports,
    });
  },
});

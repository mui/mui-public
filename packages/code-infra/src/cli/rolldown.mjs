/* eslint-disable no-console */
import { builtinModules } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { rolldown } from 'rolldown';
// import { dts as dtsPlugin } from 'rolldown-plugin-dts';
import { getVersionEnvVariables, processExportsToEntry } from '../utils/build.mjs';

/**
 * @typedef {import('rolldown').RolldownBuild} RolldownBuild
 */

/**
 * @typedef {import('./cmdBuildRolldown.mjs').Args} Args
 */

/**
 * @typedef {{directory?: string}} PublishConfig
 */

/**
 * @typedef {Object} OutChunk
 * @property {string} fileName
 * @property {string} name
 * @property {boolean} isEntry
 */

/**
 * @typedef {{esm: OutChunk[], cjs: OutChunk[], bin: OutChunk[]}} OutChunks
 */

/**
 * @param {Object} pkgJson
 * @param {string} [pkgJson.name]
 * @param {boolean} [pkgJson.private]
 * @param {string} [pkgJson.main]
 * @param {string} [pkgJson.module]
 * @param {string} [pkgJson.types]
 * @param {PublishConfig | undefined} [pkgJson.publishConfig]
 */
function validatePkgJson(pkgJson) {
  const errors = [];
  if (pkgJson.private === false) {
    errors.push(`Remove "private": false from ${pkgJson.name}'s package.json. It is redundant.`);
  }

  if (pkgJson.main || pkgJson.module || pkgJson.types) {
    errors.push(
      `Remove "main", "module", and "types" fields from ${pkgJson.name}'s package.json. Add the path to 'exports["."]' instead.`,
    );
  }

  if (!pkgJson.publishConfig?.directory) {
    errors.push(
      `No build directory specified in ${pkgJson.name}'s package.json. Add it in "publishConfig.directory".`,
    );
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
}

/**
 *
 * @param {'esm' | 'cjs'} format
 * @param {string | undefined} pkgType
 * @param {{ cwd: string; isDts?: boolean }} options
 * @returns {import('rolldown').ChunkFileNamesFunction}
 */
function getChunkFileName(format, pkgType, { cwd, isDts }) {
  /**
   * @type {string}
   */
  let extension = '';

  switch (format) {
    case 'cjs':
      if (pkgType === 'module') {
        extension = isDts ? '.d.cts' : '.cjs';
      } else {
        extension = isDts ? '.d.ts' : '.js';
      }
      break;
    case 'esm': {
      if (pkgType === 'module') {
        extension = isDts ? '.d.ts' : '.js';
      } else {
        extension = isDts ? '.d.mts' : '.mjs';
      }
      break;
    }
    default:
      break;
  }
  return (chunkInfo) => {
    // console.log(chunk, { extension });
    // if ((chunkInfo.isEntry || chunkInfo.isDynamicEntry) && chunkInfo.facadeModuleId) {
    //   const relativeDir = path.relative(cwd, chunkInfo.facadeModuleId);
    //   const fragments = relativeDir.split(path.sep);
    //   if (fragments[0] === 'src') {
    //     fragments.shift();
    //   }
    //   const relativePath = fragments.join('/');
    //   console.log({ relativePath, chunkInfo: chunkInfo.name, path: chunkInfo.facadeModuleId });
    // }
    // if (!relativePath.startsWith(chunkInfo.name)) {
    //   return `${relativePath}`
    // }
    // if (!relativePath.startsWith(chunkInfo.name)) {
    //   console.log({
    //     relativePath,
    //     rep: relativePath.replace(new RegExp(`${path.basename(relativePath)}$`), ''),
    //   });
    //   return `${relativePath.replace(new RegExp(`${path.basename(relativePath)}$`), '')}[name]${extension}`;
    // }
    // console.log({ relativePath, chunkInfo });
    // }
    return `[name]${extension}`;
  };
}

/**
 * Write the package.json file to the build directory.
 * @param {Record<string, any>} pkgJson
 * @param {string} buildDir
 * @param {OutChunks} outChunks
 */
async function writePackageJson(pkgJson, buildDir, outChunks) {
  delete pkgJson.devDependencies;
  delete pkgJson.scripts;
  delete pkgJson.imports;
  delete pkgJson.publishConfig?.directory;
  delete pkgJson.exports;
  delete pkgJson.files;
  delete pkgJson.bin;
  pkgJson.sideEffects ??= false;
  pkgJson.type ??= 'commonjs';

  /**
   * @type {Record<string, Record<string, string>>}
   */
  let newExports = {};

  /**
   * @param {string} chunkName
   */
  function getKey(chunkName) {
    if (chunkName === 'index') {
      return '.';
    }
    if (chunkName.endsWith('/index')) {
      return `./${chunkName.slice(0, -6)}`;
    }
    return `./${chunkName}`;
  }

  outChunks.esm.forEach((chunk) => {
    const key = getKey(chunk.name);
    newExports[key] = newExports[key] || {};
    newExports[key].import = `./${chunk.fileName}`;
    if (pkgJson.type === 'module') {
      newExports[key].default = newExports[key].import;
    }
  });

  outChunks.cjs.forEach((chunk) => {
    const key = getKey(chunk.name);
    newExports[key] = newExports[key] || {};

    if (pkgJson.type !== 'module') {
      newExports[key].require = `./${chunk.fileName}`;
      newExports[key].default = newExports[key].require;
    } else {
      const originalDefault = newExports[key].default;
      delete newExports[key].default;
      newExports[key].require = `./${chunk.fileName}`;
      if (originalDefault) {
        newExports[key].default = originalDefault;
      }
    }
  });

  if (newExports['.']) {
    const index = newExports['.'];
    delete newExports['.'];
    newExports = { '.': index, ...newExports };
    if (index.require) {
      pkgJson.main = index.require;
    }
    if (index.import) {
      pkgJson.module = index.import;
    }
  }

  pkgJson.exports = newExports;

  /**
   * @type {string | Record<string, string> | null}
   */
  let newBin = null;

  for (const chunk of outChunks.bin) {
    if (chunk.name === 'bin') {
      newBin = chunk.fileName;
    } else if (chunk.name.startsWith('bin/')) {
      const binObj = /** @type {Record<string, string>} */ (newBin || {});
      binObj[chunk.name.substring(4)] = `./${chunk.fileName}`;
      newBin = binObj;
    }
  }

  pkgJson.bin = newBin ?? undefined;

  const outputPath = path.join(buildDir, 'package.json');
  await fs.writeFile(outputPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
}

/**
 * @param {Args} args
 */
export async function build(args) {
  const cwd = process.cwd();
  const pkgJsonPath = path.join(cwd, 'package.json');
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));

  validatePkgJson(pkgJson);

  /**
   * @type {string}
   */
  const buildDir = pkgJson.publishConfig.directory;

  const [exportEntries, , binEntries] = await processExportsToEntry(
    pkgJson.exports ?? {},
    pkgJson.bin ?? {},
    { cwd },
  );
  if (Object.keys(exportEntries).length === 0 && Object.keys(binEntries).length === 0) {
    throw new Error(
      `No valid exports found in ${pkgJson.name}'s package.json. Entries are supported in both "exports" or "bin" fields.`,
    );
  }

  try {
    await fs.rm(buildDir, { recursive: true });
  } catch (ex) {
    if (/** @type {{code: string}} */ (ex).code !== 'ENOENT') {
      console.warn(`Failed to remove build directory ${buildDir}`);
      throw ex;
    }
  }

  /**
   * @type {Set<string>}
   */
  const externalsSet = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ]);
  const externals = Array.from(externalsSet);

  /**
   * @type {Promise<RolldownBuild | null>}
   */
  let exportBundlePromise = Promise.resolve(null);
  /**
   * @type {Promise<RolldownBuild | null>}
   */
  let binBundlePromise = Promise.resolve(null);

  const licenseBanner = `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license}
 * This source code is licensed under the ${pkgJson.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;

  /**
   * @type {import('rolldown').InputOptions}
   */
  const inputOptions = {
    cwd,
    external: /node_modules/,
    logLevel: /** @type {import('rolldown').LogLevelOption} */ (args.verbose ? 'debug' : 'silent'),
    treeshake: true,
    ...(args.watch ? { experimental: { incrementalBuild: true } } : {}),
    define: {
      ...getVersionEnvVariables(pkgJson.version),
    },
    profilerNames: !!args.watch,
    transform: {
      jsx: {
        runtime: 'automatic',
        development: !!args.watch,
        refresh: !!args.watch,
      },
    },
    ...(args.watch
      ? {
          watch: {
            include: ['package.json'],
            exclude: ['node_modules', buildDir],
            clearScreen: true,
          },
        }
      : {}),
    plugins: [
      {
        name: 'code-infra-rolldown:externals',
        async resolveId(id, importer, extraOptions) {
          if (extraOptions.isEntry) {
            return null;
          }
          if (
            id.startsWith('node:') ||
            externalsSet.has(id) ||
            externals.some((dep) => id.startsWith(`${dep}/`))
          ) {
            return {
              id,
              external: true,
              moduleSideEffects:
                id.startsWith('node:') || builtinModules.includes(id) ? false : undefined,
            };
          }
          return null;
        },
      },
    ],
    moduleTypes: {
      '.js': 'jsx',
    },
  };

  /**
   * @type {import('rolldown').OutputOptions}
   */
  const outputOptions = {
    dir: buildDir,
    banner: licenseBanner,
    minify: 'dce-only',
    legalComments: 'inline',
    preserveModules: true,
    preserveModulesRoot: 'src',
    minifyInternalExports: true,
  };

  if (Object.keys(exportEntries).length > 0) {
    exportBundlePromise = rolldown({
      ...inputOptions,
      input: exportEntries,
      platform: 'neutral',
    });
    // const cjsDts = await rolldown({
    //   ...inputOptions,
    //   plugins: [
    //     .../** @type {any[]} */ (inputOptions.plugins ?? []),
    //     dtsPlugin({
    //       cwd,
    //       tsconfig: 'tsconfig.build.json',
    //       emitDtsOnly: true,
    //       emitJs: false,
    //       compilerOptions: {
    //         paths: {},
    //       },
    //     }),
    //   ],
    //   input: exportEntries,
    //   platform: 'neutral',
    // });
    // const res = await cjsDts.write({
    //   ...outputOptions,
    //   format: 'esm',
    //   dir: buildDir,
    //   entryFileNames: getChunkFileName('esm', pkgJson.type, { cwd, isDts: true }),
    //   chunkFileNames: getChunkFileName('esm', pkgJson.type, { cwd, isDts: true }),
    // });
    // console.log(res);
  }
  if (Object.keys(binEntries).length > 0) {
    binBundlePromise = rolldown({
      ...inputOptions,
      input: binEntries,
      platform: 'node',
    });
  }

  /**
   * @type {OutChunks}
   */
  const outChunks = {
    esm: [],
    cjs: [],
    bin: [],
  };

  const [exportBundle, binBundle] = await Promise.all([exportBundlePromise, binBundlePromise]);
  if (exportBundle) {
    const esmFileName = getChunkFileName('esm', pkgJson.type, { cwd });
    const cjsFileName = getChunkFileName('cjs', pkgJson.type, { cwd });
    const [esmOutput, cjsOutput] = await Promise.all([
      exportBundle.write({
        ...outputOptions,
        name: 'esm-build',
        format: 'esm',
        entryFileNames: esmFileName,
        chunkFileNames: esmFileName,
      }),
      exportBundle.write({
        ...outputOptions,
        name: 'cjs-build',
        format: 'cjs',
        entryFileNames: cjsFileName,
        chunkFileNames: cjsFileName,
      }),
    ]);
    esmOutput.output
      .filter((out) => out.type === 'chunk' && out.isEntry)
      .forEach((chunk) => {
        if (chunk.type !== 'chunk') {
          return;
        }
        outChunks.esm.push({
          name: chunk.name,
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
        });
      });
    cjsOutput.output
      .filter((out) => out.type === 'chunk' && out.isEntry)
      .forEach((chunk) => {
        if (chunk.type !== 'chunk') {
          return;
        }
        outChunks.cjs.push({
          name: chunk.name,
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
        });
      });
  }

  if (binBundle) {
    const format = pkgJson.type === 'module' ? 'esm' : 'cjs';
    const binFileName = getChunkFileName(format, pkgJson.type, {
      cwd,
    });
    const binOutput = await binBundle.write({
      ...outputOptions,
      format,
      name: `bin-${format}-build`,
      exports: 'none',
      entryFileNames: binFileName,
      chunkFileNames: binFileName,
      preserveModules: false,
    });
    binOutput.output
      .filter((out) => out.type === 'chunk' && out.isEntry)
      .forEach((chunk) => {
        if (chunk.type !== 'chunk') {
          return;
        }
        outChunks.bin.push({
          name: chunk.name,
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
        });
      });
    await Promise.all(
      binOutput.output
        .filter((out) => out.type === 'chunk' && out.isEntry)
        .map(async (out) => {
          if (out.type === 'chunk' && out.code.trim().startsWith('#!/usr/bin/env')) {
            console.log(`[rolldown] Making ${out.fileName} executable`);
            await fs.chmod(path.join(buildDir, out.fileName), 0o755);
          }
        }),
    );
  }
  await writePackageJson(pkgJson, path.join(cwd, buildDir), outChunks);
}

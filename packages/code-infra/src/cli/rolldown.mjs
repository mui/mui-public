/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { build as rolldownBuild } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';
import { getVersionEnvVariables, processExportsToEntry, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {import('./cmdBuildRolldown.mjs').Args} Args
 */

/**
 * @typedef {import('../utils/build.mjs').OutChunks} OutChunks
 */

/**
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
   * @type {Record<string, Record<string, Record<string, string>>>}
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
    const isDtsEntry = chunk.name.endsWith('.d');
    const key = getKey(isDtsEntry ? chunk.name.substring(0, chunk.name.length - 2) : chunk.name);
    newExports[key] = newExports[key] || {};
    newExports[key].import = newExports[key].import || {};
    if (isDtsEntry) {
      newExports[key].import.types = `./${chunk.fileName}`;
    } else {
      newExports[key].import.default = `./${chunk.fileName}`;
    }
    const defaultImport = newExports[key].import.default;
    newExports[key].import = {
      ...newExports[key].import,
      default: defaultImport,
    };
  });

  // outChunks.cjs.forEach((chunk) => {
  //   const key = getKey(chunk.name);
  //   newExports[key] = newExports[key] || {};

  //   if (pkgJson.type !== 'module') {
  //     newExports[key].require = `./${chunk.fileName}`;
  //     newExports[key].default = newExports[key].require;
  //   } else {
  //     const originalDefault = newExports[key].default;
  //     delete newExports[key].default;
  //     newExports[key].require = `./${chunk.fileName}`;
  //     if (originalDefault) {
  //       newExports[key].default = originalDefault;
  //     }
  //   }
  // });

  if (newExports['.']) {
    const index = newExports['.'];
    delete newExports['.'];
    newExports = { '.': index, ...newExports };
    if (typeof index.require === 'string') {
      pkgJson.main = index.require;
    }
    if (typeof index.import === 'string') {
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
  await fs.writeFile(outputPath, `${JSON.stringify(pkgJson, null, 2)}${os.EOL}`);
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

  /**
   * @type {import('../utils/build.mjs').OutChunks}
   */
  const outChunks = {
    esm: [],
    cjs: [],
    bin: [],
  };

  const [exportBundle, cjsBundle, cjsDtsBundle, binBundle] = await Promise.all([
    rolldownBuild({
      ...inputOptions,
      plugins: [
        .../** @type any[] */ (inputOptions.plugins ?? []),
        dts({
          tsconfig: 'tsconfig.build.json',
          cwd,
          compilerOptions: {
            paths: {},
          },
        }),
      ],
      input: exportEntries,
      output: {
        ...outputOptions,
        name: 'esm-build',
        format: 'esm',
        entryFileNames: getChunkFileName('esm', pkgJson.type, { cwd }),
        chunkFileNames: getChunkFileName('esm', pkgJson.type, { cwd }),
      },
    }),
    rolldownBuild({
      ...inputOptions,
      input: exportEntries,
      output: {
        ...outputOptions,
        name: 'cjs-build',
        format: 'cjs',
        entryFileNames: getChunkFileName('cjs', pkgJson.type, { cwd }),
        chunkFileNames: getChunkFileName('cjs', pkgJson.type, { cwd }),
      },
    }),
    rolldownBuild({
      ...inputOptions,
      plugins: [
        .../** @type any[] */ (inputOptions.plugins ?? []),
        dts({
          tsconfig: 'tsconfig.build.json',
          cwd,
          compilerOptions: {
            paths: {},
          },
          emitDtsOnly: true,
          resolve: false,
          cjsDefault: true,
        }),
      ],
      input: exportEntries,
      output: {
        ...outputOptions,
        name: 'cjs-dts-build',
        format: 'esm',
        entryFileNames: getChunkFileName('cjs', pkgJson.type, { cwd, isDts: true }),
        chunkFileNames: getChunkFileName('cjs', pkgJson.type, { cwd, isDts: true }),
      },
    }),
    Object.keys(binEntries).length > 0
      ? rolldownBuild({
          ...inputOptions,
          input: binEntries,
          output: {
            ...outputOptions,
            name: 'bin-build',
            format: pkgJson.type === 'module' ? 'esm' : 'cjs',
            entryFileNames: getChunkFileName(
              pkgJson.type === 'module' ? 'esm' : 'cjs',
              pkgJson.type,
              {
                cwd,
              },
            ),
            chunkFileNames: getChunkFileName(
              pkgJson.type === 'module' ? 'esm' : 'cjs',
              pkgJson.type,
              {
                cwd,
              },
            ),
          },
        })
      : Promise.resolve(null),
  ]);
  exportBundle.output
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

  cjsBundle.output
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

  if (binBundle) {
    binBundle.output
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
  }

  console.log(cjsDtsBundle.output);

  // const [exportBundle, binBundle] = await Promise.all([exportBundlePromise, binBundlePromise]);
  // if (exportBundle) {
  //   const esmFileName = getChunkFileName('esm', pkgJson.type, { cwd });
  //   const cjsFileName = getChunkFileName('cjs', pkgJson.type, { cwd });
  //   const [esmOutput, cjsOutput] = await Promise.all([
  //     exportBundle.write({
  //       ...outputOptions,
  //       name: 'esm-build',
  //       format: 'esm',
  //       entryFileNames: esmFileName,
  //       chunkFileNames: esmFileName,
  //     }),
  //     exportBundle.write({
  //       ...outputOptions,
  //       name: 'cjs-build',
  //       format: 'cjs',
  //       entryFileNames: cjsFileName,
  //       chunkFileNames: cjsFileName,
  //     }),
  //   ]);
  //   esmOutput.output
  //     .filter((out) => out.type === 'chunk' && out.isEntry)
  //     .forEach((chunk) => {
  //       if (chunk.type !== 'chunk') {
  //         return;
  //       }
  //       outChunks.esm.push({
  //         name: chunk.name,
  //         fileName: chunk.fileName,
  //         isEntry: chunk.isEntry,
  //       });
  //     });
  //   cjsOutput.output
  //     .filter((out) => out.type === 'chunk' && out.isEntry)
  //     .forEach((chunk) => {
  //       if (chunk.type !== 'chunk') {
  //         return;
  //       }
  //       outChunks.cjs.push({
  //         name: chunk.name,
  //         fileName: chunk.fileName,
  //         isEntry: chunk.isEntry,
  //       });
  //     });
  // }

  // if (binBundle) {
  //   const format = pkgJson.type === 'module' ? 'esm' : 'cjs';
  //   const binFileName = getChunkFileName(format, pkgJson.type, {
  //     cwd,
  //   });
  //   const binOutput = await binBundle.write({
  //     ...outputOptions,
  //     format,
  //     name: `bin-${format}-build`,
  //     exports: 'none',
  //     entryFileNames: binFileName,
  //     chunkFileNames: binFileName,
  //     preserveModules: false,
  //   });
  //   binOutput.output
  //     .filter((out) => out.type === 'chunk' && out.isEntry)
  //     .forEach((chunk) => {
  //       if (chunk.type !== 'chunk') {
  //         return;
  //       }
  //       outChunks.bin.push({
  //         name: chunk.name,
  //         fileName: chunk.fileName,
  //         isEntry: chunk.isEntry,
  //       });
  //     });
  //   await Promise.all(
  //     binOutput.output
  //       .filter((out) => out.type === 'chunk' && out.isEntry)
  //       .map(async (out) => {
  //         if (out.type === 'chunk' && out.code.trim().startsWith('#!/usr/bin/env')) {
  //           console.log(`[rolldown] Granting execute permission to ${out.fileName}`);
  //           await fs.chmod(path.join(buildDir, out.fileName), 0o755);
  //         }
  //       }),
  //   );
  // }
  await writePackageJson(pkgJson, path.join(cwd, buildDir), outChunks);
}

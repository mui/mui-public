import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { build as tsdownBuild } from 'tsdown';
import { getVersionEnvVariables, processExportsToEntry, validatePkgJson } from '../utils/build.mjs';

/**
 * @typedef {import('rolldown').OutputBundle} OutputBundle
 */

/**
 * @typedef {{esm: OutputBundle, cjs: OutputBundle; bin: OutputBundle}} OutputChunks
 */
/**
 * @typedef {import('./cmdBuildRolldown.mjs').Args} Args
 */

const TS_CONFIG_PATHS = ['tsconfig.build.json', 'tsconfig.json'];

/**
 * @param {string} cwd
 * @returns {Promise<string|null>}
 */
async function getTsConfigPath(cwd) {
  for (const configPath of TS_CONFIG_PATHS) {
    const fullPath = path.join(cwd, configPath);
    if (
      // eslint-disable-next-line no-await-in-loop
      await fs
        .stat(fullPath)
        .then((stat) => stat.isFile())
        .catch(() => false)
    ) {
      return configPath;
    }
  }
  return null;
}

/**
 *
 * @param {import('../../package.json')} pkgJson
 * @param {OutputChunks} chunks
 * @param {{buildDir: string; cwd: string}} options
 */
async function writePkgJson(pkgJson, chunks, { cwd, buildDir }) {
  const buildPkgJsonPath = path.join(cwd, buildDir, 'package.json');
  // @ts-expect-error Can be deleted
  delete pkgJson.devDependencies;
  // @ts-expect-error Can be deleted
  delete pkgJson.scripts;
  // @ts-expect-error Can be deleted
  delete pkgJson.publishConfig?.directory;
  // @ts-expect-error Can be deleted
  delete pkgJson.exports;
  // @ts-expect-error Can be deleted
  delete pkgJson.bin;
  pkgJson.sideEffects ??= false;
  pkgJson.type ??= 'commonjs';
}

/**
 * @param {Args} args
 */
export async function build(args) {
  const cwd = process.cwd();
  const pkgJsonPath = path.join(cwd, 'package.json');
  /**
   * @type {import('../../package.json')}
   */
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));

  validatePkgJson(pkgJson);

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

  /**
   * @type {Promise<void>[]}
   */
  const promises = [];

  const licenseBanner = `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license}
 * This source code is licensed under the ${pkgJson.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;
  /**
   * @type {(string | RegExp)[]}
   */
  const externals = Array.from(
    new Set([
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.peerDependencies ?? {}),
    ]),
  );
  externals.push(/^node:/, /^@types\//);

  /**
   * @type {OutputChunks}
   */
  const outputChunks = {
    esm: {},
    cjs: {},
    bin: {},
  };

  /**
   * @type {import('tsdown').Options}
   */
  const baseOptions = {
    watch: args.watch,
    config: false,
    outDir: buildDir,
    unbundle: true,
    target: 'node14',
    clean: !args.watch,
    skipNodeModulesBundle: true,
    banner: {
      js: licenseBanner,
      css: licenseBanner,
    },
    external: externals,
    platform: 'neutral',
    ignoreWatch: ['build', 'dist', 'node_modules'],
    define: {
      ...getVersionEnvVariables(pkgJson.version),
    },
    loader: {
      '.js': 'jsx',
    },
  };

  if (Object.keys(exportEntries).length > 0) {
    const tsconfigPath = await getTsConfigPath(cwd);
    args.bundle.forEach((format) => {
      promises.push(
        tsdownBuild({
          ...baseOptions,
          entry: exportEntries,
          format,
          tsconfig: tsconfigPath ?? undefined,
          dts: tsconfigPath
            ? {
                cwd,
                emitJs: false,
              }
            : false,
          outputOptions: {
            plugins: [
              {
                name: 'get-output-chunks',
                writeBundle(_ctx, chunks) {
                  outputChunks[format] = chunks;
                },
              },
            ],
          },
        }),
      );
    });
  }

  if (Object.keys(binEntries).length > 0) {
    const format = pkgJson.type === 'module' ? 'esm' : 'cjs';
    promises.push(
      tsdownBuild({
        ...baseOptions,
        entry: binEntries,
        format,
        platform: 'node',
        outputOptions: {
          plugins: [
            {
              name: 'get-output-chunks-1',
              writeBundle(_ctx, chunks) {
                outputChunks.bin = chunks;
              },
            },
          ],
        },
      }),
    );
  }

  await Promise.all(promises);
  await writePkgJson(pkgJson, outputChunks, { cwd, buildDir });
}

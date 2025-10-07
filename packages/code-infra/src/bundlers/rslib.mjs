import * as fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { build as rslib } from '@rslib/core';

import {
  generateEntriesFromExports,
  getTsConfigPath,
  getVersionEnvVariables,
} from '../utils/build.mjs';

/**
 * Findings -
 * 1. Bundleless option is buggy. We cannot have `entry1/index.ts` and `entry2/index.ts`.
 * 2. For some reason, typings are only generated for esm build and not cjs build.
 */

/**
 * @typedef {import('../cli/cmdBuildNew.mjs').BaseArgs} Args
 */

/**
 * @typedef {import('../cli/cmdBuildNew.mjs').PackageJson} PackageJson
 */

/**
 * @param {Args} args
 * @param {PackageJson} pkgJson
 * @returns {Promise<void>}
 */
export async function build(args, pkgJson) {
  const cwd = process.cwd();

  const outDir = /** @type {any} */ (pkgJson.publishConfig)?.directory;
  await fs.rm(outDir, {
    recursive: true,
    force: true,
  });

  const [exportEntries, , binEntries] = await generateEntriesFromExports(
    pkgJson.exports ?? {},
    pkgJson.bin ?? {},
    { cwd },
  );
  const externals = new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {}),
  ]);
  /**
   * @type {(string|RegExp)[]}
   */
  const externalsArray = Array.from(externals);
  externalsArray.push(new RegExp(`^(${externalsArray.join('|')})/`));
  externalsArray.push(/^node:/);
  externalsArray.push(...builtinModules);

  const tsconfigPath = await getTsConfigPath(cwd);
  const bannerText = `/**
  * ${pkgJson.name} v${pkgJson.version}
  *
  * @license ${pkgJson.license ?? 'MIT'}
  * This source code is licensed under the ${pkgJson.license} license found in the
  * LICENSE file in the root directory of this source tree.
  */
`;

  /**
   * @type {import('@rslib/core').LibConfig}
   */
  const baseLibOptions = {
    banner: {
      js: bannerText,
      css: bannerText,
    },
    bundle: true,
    autoExternal: true,
    externalHelpers: true,
    autoExtension: true,
    dts: {
      autoExtension: true,
      distPath: outDir,
    },
  };

  const instance = await rslib(
    {
      mode: 'production',
      root: cwd,
      logLevel: args.verbose ? 'info' : 'warn',
      source: {
        entry: exportEntries,
        tsconfigPath: tsconfigPath ?? undefined,
        define: {
          ...getVersionEnvVariables(/** @type {string} */ (pkgJson.version)),
        },
      },
      lib: [
        {
          ...baseLibOptions,
          format: 'esm',
        },
        {
          ...baseLibOptions,
          format: 'cjs',
        },
        {
          ...baseLibOptions,
          source: {
            entry: binEntries,
          },
          format: pkgJson.type === 'module' ? 'esm' : 'cjs',
          bundle: true,
          dts: false,
        },
      ],
      output: {
        legalComments: 'inline',
        target: 'web',
        distPath: {
          root: outDir,
        },
        externals: externalsArray,
        minify: false,
        filename: {
          js: '[name].js',
        },
      },
    },
    {
      root: cwd,
    },
  );
  const res = await instance.build();
  await fs.writeFile('build/manifest.json', `${JSON.stringify(res.stats?.toJson({}), null, 2)}\n`);
  await res.close();
}

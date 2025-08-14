import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import browserlist from 'browserslist';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defineConfig } from 'tsdown/config';
import { processExportsToEntry } from './utils/build.mjs';

const TS_CONFIG_PATHS = ['tsconfig.build.json', 'tsconfig.json'];

export default defineConfig(async (opts) => {
  const cwd = opts.cwd ?? process.cwd();
  const pkgJsonPath = path.join(cwd, 'package.json');
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
  const buildDirBase = pkgJson.publishConfig?.directory ?? 'build';
  if (!buildDirBase) {
    throw new Error(
      'No build directory specified in package.json. Specify it in the "publishConfig.directory" field.',
    );
  }
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error(
      'No workspace directory found. Make sure that your package is in a pnpm workspace.',
    );
  }
  const browserListRcPath = path.join(workspaceDir, '.browserslistrc');
  const browserListExists = await fs
    .stat(browserListRcPath)
    .then(() => true)
    .catch(() => false);
  /**
   * @type {browserlist.Config | undefined}
   */
  let browserlistConfig;
  if (browserListExists) {
    browserlistConfig = browserlist.parseConfig(
      await fs.readFile(browserListRcPath, { encoding: 'utf8' }),
    );
    // eslint-disable-next-line no-console
    console.log(browserlistConfig);
  }
  /**
   * @type {string|undefined}
   */
  let tsConfigPath;

  for (const configPath of TS_CONFIG_PATHS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await fs
      .stat(path.join(cwd, configPath))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      tsConfigPath = configPath;
      break;
    }
  }

  const [entries] = await processExportsToEntry(pkgJson.exports, pkgJson.bin, {
    cwd,
  });
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
   * @type {import('tsdown').Options}
   */
  const baseOptions = {
    skipNodeModulesBundle: true,
    format: ['esm', 'cjs'],
    unbundle: true,
    tsconfig: tsConfigPath ?? false,
    dts: !!tsConfigPath,
    hash: false,
    inputOptions: {
      cwd,
      platform: 'neutral',
      logLevel: 'warn',
      external: externals,
    },
    banner: {
      js: `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license}
 * This source code is licensed under the ${pkgJson.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`,
    },
    ignoreWatch: ['build'],
  };

  /**
   * @type {any}
   */
  let out;

  return {
    ...baseOptions,
    ...out,
    entry: entries,
    watch: opts.watch ? {} : false,
    outDir: buildDirBase,
    exports: {
      customExports(newExports, { chunks }) {
        out = {
          newExports,
          chunks,
        };
        return pkgJson.exports;
      },
    },
    async onSuccess() {
      // console.log('Build successful:', JSON.stringify(out, null, 2));
    },
  };
});

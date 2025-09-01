/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import browserlist from 'browserslist';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from 'tsdown/config';
import { getVersionEnvVariables, processExports, processExportsToEntry } from './utils/build.mjs';

const TS_CONFIG_PATHS = ['tsconfig.build.json', 'tsconfig.json'];

/**
 * @TODOs -
 * [ ] Handle custom babel plugin transforms
 * [ ] Figure out how to pass targets (easy to do if we want to have same target for all output formats)
 * [x] Write your own package.json exports (the one built into tsdown doesn't cut it)
 * [ ] Side effects from type imports without the "type" identifier. Need eslint rule to enforce this.
 * [ ] Figure out how to handle conditional exports. Specifically `react-server` exports.
 */

/**
 * @param {any} baseOutput
 * @param {any} binOutput
 * @param {string[]} nullEntries
 * @param {{ buildDirBase: string }} options
 */
async function writePkgJson(baseOutput, binOutput, nullEntries, { buildDirBase }) {
  const originalPkgJsonPath = path.join(process.cwd(), 'package.json');
  const pkgJson = JSON.parse(await fs.readFile(originalPkgJsonPath, { encoding: 'utf8' }));
  const originalPkgJson = JSON.parse(JSON.stringify(pkgJson));
  if (pkgJson.private === false) {
    throw new Error('Remove field "private" from package.json. Only add it if the value is true.');
  }
  delete pkgJson.scripts;
  delete pkgJson.devDependencies;
  const buildDir = pkgJson.publishConfig?.directory;
  delete pkgJson.publishConfig?.directory;
  delete pkgJson.imports;
  // const oldExports = pkgJson.exports;
  delete pkgJson.exports;
  const [newExports, topLevelExports] = processExports(baseOutput?.exports ?? {}, { buildDirBase });
  pkgJson.exports = newExports ?? {};
  if (topLevelExports.main) {
    pkgJson.main = topLevelExports.main;
  }
  if (topLevelExports.types) {
    pkgJson.types = topLevelExports.types;
  }
  if (topLevelExports.module) {
    pkgJson.module = topLevelExports.module;
  } else {
    delete pkgJson.module;
  }
  if (binOutput?.exports) {
    const newExports1 = processExports(binOutput.exports, { buildDirBase })[0];
    if (newExports1['.']) {
      pkgJson.bin = newExports1['.'];
    } else {
      pkgJson.bin = newExports1;
      delete pkgJson.bin['.'];
      delete pkgJson.bin['./package.json'];
    }
  }
  if (baseOutput?.exports) {
    pkgJson.exports['./package.json'] = './package.json';
  }
  nullEntries?.forEach((entry) => {
    pkgJson.exports[entry] = null;
  });
  await fs.writeFile(
    path.join(process.cwd(), buildDir, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
  );
  // tsdown adds the main entries in the original package.json which we have to remove. This is a temporary workaround.
  delete originalPkgJson.main;
  delete originalPkgJson.types;
  delete originalPkgJson.module;
  await fs.writeFile(originalPkgJsonPath, `${JSON.stringify(originalPkgJson, null, 2)}${os.EOL}`);
}

export default defineConfig(async (opts) => {
  const cwd = opts.cwd ?? process.cwd();
  const pkgJsonPath = path.join(cwd, 'package.json');
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, { encoding: 'utf8' }));
  const buildDirBase = /** @type {string | undefined} */ (pkgJson.publishConfig?.directory);
  if (!buildDirBase) {
    throw new Error(
      `No build directory specified in "${pkgJson.name}" package.json. Specify it in the "publishConfig.directory" field.`,
    );
  }
  if (pkgJson.private === false) {
    throw new Error(
      `Remove the field "private": false from "${pkgJson.name}" package.json. This is redundant.`,
    );
  }
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('No workspace found. Make sure that your package is in a pnpm workspace.');
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

  const [entries, nullEntries, binEntries] = await processExportsToEntry(
    pkgJson.exports,
    pkgJson.bin,
    {
      cwd,
    },
  );
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

  const licenseBanner = `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license}
 * This source code is licensed under the ${pkgJson.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;

  /**
   * @type {import('tsdown/config').UserConfig}
   */
  const baseOptions = {
    ...opts,
    cwd,
    skipNodeModulesBundle: true,
    platform: 'neutral',
    unbundle: true,
    watch: !!opts.watch,
    tsconfig: tsConfigPath ?? false,
    dts: tsConfigPath
      ? {
          emitJs: false,
        }
      : false,
    hash: false,
    logLevel: 'info',
    external: externals,
    banner: {
      js: licenseBanner,
      css: licenseBanner,
    },
    nodeProtocol: true,
    ignoreWatch: ['build', 'dist', 'node_modules'],
    loader: {
      '.js': 'jsx',
    },
    env: {
      ...getVersionEnvVariables(pkgJson.version),
    },
    outputOptions: {
      minify: 'dce-only',
    },
  };

  // /**
  //  * @type {any}
  //  */
  // let out;

  if (!Object.keys(entries).length && !Object.keys(binEntries).length) {
    throw new Error(
      'No valid entries found in package.json "exports" or "bin". If you are specifying a "main"/"module" entry, remove that and specify it in "exports[\'.\']"',
    );
  }

  let baseComplete = Object.keys(entries).length < 1,
    binComplete = Object.keys(binEntries).length < 1;

  /**
   * @type {any}
   */
  let baseOutput;
  /**
   * @type {any}
   */
  let binOutput;

  return /** @type {import('tsdown/config').UserConfig} */ (
    [
      Object.keys(entries).length > 0
        ? {
            ...baseOptions,
            entry: entries,
            format: ['cjs', 'esm'],
            outDir: buildDirBase,
            /**
             * @type {import('tsdown').Options["exports"]}
             */
            exports: {
              customExports(newExports, { chunks, outDir }) {
                baseOutput = {
                  exports: newExports,
                  chunks,
                  outDir,
                };
                return pkgJson.exports ?? {};
              },
            },
            async onSuccess() {
              baseComplete = true;
              if (binComplete) {
                await writePkgJson(baseOutput, binOutput, nullEntries, {
                  buildDirBase,
                });
              }
            },
          }
        : null,
      Object.keys(binEntries).length
        ? {
            ...baseOptions,
            dts: false,
            entry: binEntries,
            format: pkgJson.type === 'module' ? 'esm' : 'cjs',
            outDir: buildDirBase,
            platform: 'node',
            unbundle: false,
            /**
             * @type {import('tsdown').Options["exports"]}
             */
            exports: {
              customExports(newExports, { chunks, outDir }) {
                binOutput = {
                  exports: newExports,
                  chunks,
                  outDir,
                };
                return pkgJson.exports ?? {};
              },
            },
            async onSuccess() {
              binComplete = true;
              if (baseComplete) {
                await writePkgJson(baseOutput, binOutput, nullEntries, {
                  buildDirBase,
                });
              }
            },
          }
        : null,
    ].filter(Boolean)
  );
});

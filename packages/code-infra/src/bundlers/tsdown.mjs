/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import pluginBabel from '@rollup/plugin-babel';
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import * as semver from 'semver';
import { build as tsdown } from 'tsdown';
import {
  generateEntriesFromExports,
  getTsConfigPath,
  getVersionEnvVariables,
  writePkgJson,
} from '../utils/build.mjs';
import { copyFiles } from '../utils/copyFiles.mjs';
/**
 * @TODOs -
 * [x] Handle custom babel plugin transforms
 * [ ] Figure out how to pass targets (easy to do if we want to have same target for all output formats)
 * [x] Write your own package.json exports (the one built into tsdown doesn't cut it)
 * [x] Side effects from type imports without the "type" identifier. Need eslint rule to enforce this.
 * [ ] Figure out how to handle conditional exports. Specifically `react-server` exports.
 */

/**
 * @typedef {import('../cli/cmdBuildNew.mjs').Args} Args
 */

/**
 * @param {Args} args
 * @param {import('../cli/packageJson').PackageJson} pkgJson
 * @returns {Promise<void>}
 */
export async function build(args, pkgJson) {
  const cwd = process.cwd();
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Could not find workspace root');
  }

  const outDir = /** @type {any} */ (pkgJson.publishConfig)?.directory;
  await fs.rm(outDir, {
    recursive: true,
    force: true,
  });

  const [exportEntries, nullEntries, binEntries] = await generateEntriesFromExports(
    /** @type {import('../utils/build.mjs').Exports} */ (pkgJson.exports) ?? {},
    /** @type {string | Record<string, string>} */ (pkgJson.bin) ?? {},
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
  externalsArray.push(/\.css$/);
  externalsArray.push(...builtinModules);

  const tsconfigPath = args.skipTypes ? null : await getTsConfigPath(cwd);
  const bannerText = `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license ?? 'MIT'}
 * This source code is licensed under the ${pkgJson.license} license found in the
 * LICENSE file in the root directory of this source tree.
 */
`;

  /**
   * @type {import('tsdown').InlineConfig}
   */
  const baseOptions = {
    shims: true,
    watch: false,
    config: false,
    outDir,
    unbundle: true,
    clean: false,
    skipNodeModulesBundle: true,
    external: externalsArray,
    platform: 'neutral',
    ignoreWatch: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    env: {
      ...getVersionEnvVariables(pkgJson.version ?? ''),
    },
    loader: {
      '.js': 'jsx',
    },
    logLevel: args.verbose ? 'info' : 'silent',
    tsconfig: tsconfigPath ?? false,
    sourcemap: args.sourceMap || false,
    banner: {
      js: bannerText,
      css: bannerText,
    },
    minify: 'dce-only',
    hash: false,
    name: pkgJson.name,
    plugins: [],
    treeshake: {
      propertyReadSideEffects: false,
      propertyWriteSideEffects: false,
    },
  };

  const babelConfigMjs = await fs
    .stat(path.join(workspaceDir, 'babel.config.mjs'))
    .then((stat) => stat.isFile())
    .catch(() => false);
  const babelConfigJs = await fs
    .stat(path.join(workspaceDir, 'babel.config.js'))
    .then((stat) => stat.isFile())
    .catch(() => false);

  if (babelConfigMjs || babelConfigJs) {
    let babelRuntimeVersion = pkgJson.dependencies?.['@babel/runtime'] ?? '';
    if (babelRuntimeVersion === 'catalog:') {
      // resolve the version from the given package
      // outputs the pnpm-workspace.yaml config as json
      const { stdout: configStdout } = await $`pnpm config list --json`;
      const pnpmWorkspaceConfig = JSON.parse(configStdout);
      babelRuntimeVersion = pnpmWorkspaceConfig.catalog['@babel/runtime'];
    }

    if (!babelRuntimeVersion) {
      throw new Error(
        'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
      );
    }
    let reactVersion = '';
    if (args.enableReactCompiler) {
      reactVersion = semver.minVersion(pkgJson.peerDependencies?.react || '')?.version ?? 'latest';
      const mode = process.env.MUI_REACT_COMPILER_MODE ?? 'opt-in';
      console.log(
        `[feature] Building with React compiler enabled. The compiler mode is "${mode}" right now.${mode === 'opt-in' ? ' Use explicit "use memo" directives in your components to enable the React compiler for them.' : ''}`,
      );
    }

    // @ts-expect-error The plugins field exists and is an array
    (baseOptions.plugins ?? []).push(
      pluginBabel({
        configFile: babelConfigMjs || babelConfigJs,
        babelHelpers: 'runtime',
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'],
        parserOpts: {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        },
        skipPreflightCheck: true,
        caller: /** @type {any} */ ({
          name: 'tsdown-bundler',
          babelRuntimeVersion,
          reactCompilerReactVersion: reactVersion,
          optimizeClsx:
            pkgJson.dependencies?.clsx !== undefined ||
            pkgJson.dependencies?.classnames !== undefined,
          removePropTypes: pkgJson.dependencies?.['prop-types'] !== undefined,
        }),
      }),
    );
  }

  /**
   * @type {Promise<import('tsdown').TsdownBundle[]>[]}
   */
  const promises = [];

  /**
   * @type {Record<string, {paths: string[]; isBin?: boolean}>}
   */
  const outChunks = {};
  /**
   * @type {Set<string>}
   */
  const exportEntrySet = new Set();
  /**
   * @type {Set<string>}
   */
  const binEntrySet = new Set();

  if (Object.keys(exportEntries).length > 0) {
    args.bundle.forEach((format) => {
      promises.push(
        tsdown({
          ...baseOptions,
          entry: exportEntries,
          format,
          dts: tsconfigPath
            ? {
                cwd,
                tsconfig: tsconfigPath,
                compilerOptions: {
                  jsx: 'react-jsx',
                  outDir,
                },
                sourcemap: args.sourceMap ?? false,
              }
            : false,
          outputOptions: {
            plugins: [
              {
                name: `get-output-chunks-${format}`,
                writeBundle(_ctx, chunks) {
                  Object.entries(chunks).forEach(([fileName, chunk]) => {
                    if (chunk.type !== 'chunk' || !chunk.isEntry) {
                      return;
                    }
                    const chunkName = chunk.name.endsWith('.d')
                      ? chunk.name.slice(0, -2)
                      : chunk.name;
                    outChunks[chunkName] = outChunks[chunkName] || { paths: [] };
                    outChunks[chunkName].paths.push(fileName);
                    exportEntrySet.add(chunkName);
                  });
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
      tsdown({
        ...baseOptions,
        tsconfig: undefined,
        entry: binEntries,
        format,
        platform: 'node',
        outputOptions: {
          plugins: [
            {
              name: 'bin-shebang',
              // eslint-disable-next-line consistent-return
              renderChunk(code, chunk) {
                if (chunk.isEntry && !code.includes('#!/usr/bin/env')) {
                  return `#!/usr/bin/env node\n${code}`;
                }
              },
            },
            {
              name: 'get-output-chunks-bin',
              writeBundle(_ctx, chunks) {
                Object.entries(chunks).forEach(([fileName, chunk]) => {
                  if (chunk.type !== 'chunk' || !chunk.isEntry) {
                    return;
                  }
                  outChunks[chunk.name] = outChunks[chunk.name] || { paths: [], isBin: true };
                  outChunks[chunk.name].paths.push(fileName);
                  binEntrySet.add(chunk.name);
                });
              },
            },
          ],
        },
      }),
    );
  }
  await Promise.all(promises);

  if (exportEntrySet.size || binEntrySet.size) {
    const messages = [];
    if (exportEntrySet.size > 0) {
      messages.push(`${exportEntrySet.size} export${exportEntrySet.size > 1 ? 's' : ''}`);
    }
    if (binEntrySet.size > 0) {
      messages.push(`${binEntrySet.size} bin ${binEntrySet.size > 1 ? 'entries' : 'entry'}`);
    }
    if (messages.length > 0) {
      console.log(`+ Added ${messages.join(' and ')} to package.json.`);
    }
  }

  await writePkgJson(pkgJson, outChunks, nullEntries, {
    usePkgType: true,
  });

  // tsdown's --copy arg doesn't support glob patterns.
  await copyFiles({
    cwd,
    globs: args.copy ?? [],
    buildDir: outDir,
    verbose: args.verbose,
  });
}

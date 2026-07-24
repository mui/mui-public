/* eslint-disable no-console */

import * as babel from '@babel/core';
import { globby } from 'globby';
import * as path from 'node:path';
import { rolldown } from 'rolldown';

import { getVersionEnvVariables, resolveBabelConfigFile } from './babel.mjs';
import { BASE_IGNORES } from './build.mjs';
import {
  createInlineMetadataConstantsPlugin,
  scanMetadataConstants,
} from './inlineMetadataConstants.mjs';
import { preserveNamespaces } from './rolldownPreserveNamespaces.mjs';

const TO_TRANSFORM_EXTENSIONS = ['.js', '.ts', '.tsx'];

/**
 * Babel resolves its config per file because `overrides` are matched against the filename,
 * so the config is loaded inside the transform hook rather than once up front.
 *
 * @param {import('./build.mjs').BundleType} bundle
 * @returns {string} The Babel `envName`, matching the `BABEL_ENV` the CLI build uses.
 */
function getBabelEnvName(bundle) {
  return bundle === 'esm' ? 'stable' : 'node';
}

/**
 * Reads the resolved `modules` option of whichever preset declares one, which in practice is
 * `@babel/preset-env`. Returns `undefined` when no preset declares it, in which case the
 * module format is left to whatever the caller's `supportsStaticESM` implies.
 *
 * @param {import('@babel/core').PartialConfig} partialConfig
 * @returns {unknown}
 */
function getResolvedModulesOption(partialConfig) {
  for (const preset of partialConfig.options.presets ?? []) {
    if (typeof preset !== 'object' || preset === null || !('options' in preset)) {
      continue;
    }
    const { options } = preset;
    if (typeof options === 'object' && options !== null && 'modules' in options) {
      return options.modules;
    }
  }
  return undefined;
}

/**
 * Rolldown owns the module format, so Babel must leave ES module syntax intact. That is
 * requested through `MUI_KEEP_ES_MODULES`, which only takes effect if the package's Babel
 * config routes through `@mui/internal-code-infra/babel-config`. Fail loudly rather than
 * emit output that silently mixes CommonJS into an ES module graph.
 *
 * @param {Object} options
 * @param {string} options.configFile - The Babel config file governing the package.
 * @param {string} options.filename - A representative source file to resolve the config for.
 * @param {string} options.cwd - The package root directory.
 * @param {string} options.envName - The Babel env name.
 * @returns {Promise<void>}
 */
async function assertKeepsEsModules({ configFile, filename, cwd, envName }) {
  const partialConfig = await babel.loadPartialConfigAsync({ configFile, filename, cwd, envName });
  if (!partialConfig) {
    throw new Error(`Babel resolved no config from ${configFile} for ${filename}`);
  }

  const modules = getResolvedModulesOption(partialConfig);
  if (modules !== undefined && modules !== false) {
    throw new Error(
      `The Babel config at ${configFile} converts ES modules to "${modules}" even though ` +
        `MUI_KEEP_ES_MODULES is set. Rolldown needs the ES module syntax intact to build the ` +
        `module graph.\n` +
        `Ensure the config derives from "@mui/internal-code-infra/babel-config", or set ` +
        `preset-env's "modules" option to false for this build.`,
    );
  }
}

/**
 * Builds a package with rolldown, using one entrypoint per source file so that the output
 * mirrors the source tree one-to-one, exactly like the Babel CLI build it mirrors.
 *
 * Rolldown owns module discovery: resolving specifiers and flattening re-exports. Babel is
 * still responsible for transforming each file's code.
 *
 * @param {Object} options
 * @param {boolean} [options.verbose=false] - Whether to enable verbose logging.
 * @param {boolean} [options.optimizeClsx=false] - Whether to enable clsx call optimization transform.
 * @param {boolean} [options.removePropTypes=false] - Whether to enable removal of React prop types.
 * @param {Object} [options.reactCompiler] - Whether to use the React compiler.
 * @param {string} [options.reactCompiler.reactVersion] - The React version to use with the React compiler.
 * @param {string[]} [options.ignores] - The globs to be ignored.
 * @param {string} options.cwd - The package root directory.
 * @param {string} options.pkgVersion - The package version.
 * @param {string} options.sourceDir - The source directory to build from.
 * @param {string} options.outDir - The output directory for the build.
 * @param {string} options.outExtension - The output file extension for the build.
 * @param {boolean} options.hasLargeFiles - Whether the build includes large files.
 * @param {import('./build.mjs').BundleType} options.bundle - The bundle to build.
 * @param {string} options.babelRuntimeVersion - The version of @babel/runtime to use.
 * @returns {Promise<void>}
 */
export async function build({
  cwd,
  sourceDir,
  outDir,
  babelRuntimeVersion,
  hasLargeFiles,
  bundle,
  pkgVersion,
  outExtension,
  optimizeClsx = false,
  removePropTypes = false,
  verbose = false,
  ignores = [],
  reactCompiler,
}) {
  console.log(
    `Bundling files to "${path.relative(path.dirname(sourceDir), outDir)}" for "${bundle}" bundle with rolldown.`,
  );

  const configFile = await resolveBabelConfigFile(cwd);
  const envName = getBabelEnvName(bundle);

  // The Babel config reads these from the environment. The CLI build passes them to a fresh
  // subprocess per bundle; running in-process, they must be assigned before the first config
  // load, because Babel caches the config file's result per `envName` and will not observe
  // later mutations.
  //
  // Assigning `undefined` to `process.env` stores the string "undefined", which every one of
  // these flags would read as truthy, so unset values have to be dropped instead.
  const buildEnv = {
    ...getVersionEnvVariables(pkgVersion),
    NODE_ENV: 'production',
    MUI_KEEP_ES_MODULES: 'true',
    MUI_BABEL_RUNTIME_VERSION: babelRuntimeVersion,
    MUI_OPTIMIZE_CLSX: optimizeClsx ? 'true' : undefined,
    MUI_REMOVE_PROP_TYPES: removePropTypes ? 'true' : undefined,
    MUI_BUILD_VERBOSE: verbose ? 'true' : undefined,
    MUI_REACT_COMPILER: reactCompiler?.reactVersion ? '1' : '0',
    MUI_REACT_COMPILER_REACT_VERSION: reactCompiler?.reactVersion,
  };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const allIgnores = BASE_IGNORES.concat(ignores);
  const sourceFiles = await globby(`**/*{${TO_TRANSFORM_EXTENSIONS.join(',')}}`, {
    cwd: sourceDir,
    ignore: allIgnores,
  });

  if (sourceFiles.length === 0) {
    throw new Error(`No source files found in ${sourceDir}`);
  }

  await assertKeepsEsModules({
    configFile,
    filename: path.join(sourceDir, sourceFiles[0]),
    cwd,
    envName,
  });

  // Collected up front so every module's metadata constants are known no matter the order
  // rolldown transforms files in.
  const constantsByModule = await scanMetadataConstants(sourceFiles, sourceDir);
  const inlineStats = { inlined: 0 };
  const inlineMetadataConstants = createInlineMetadataConstantsPlugin({
    constantsByModule,
    stats: inlineStats,
  });

  // Every source file is an entrypoint, so nothing can be treeshaken away and the output
  // keeps a file for every input. `preserveModules` then guarantees the layout rather than
  // leaving it to emerge from chunking.
  const input = Object.fromEntries(
    sourceFiles.map((file) => [
      file.slice(0, -path.extname(file).length),
      path.join(sourceDir, file),
    ]),
  );

  const bundleHandle = await rolldown({
    input,
    // Nothing outside the package is part of the graph. This mirrors the Babel CLI build,
    // which resolves no specifiers at all.
    external: (id, _importer, isResolved) =>
      !isResolved && !id.startsWith('.') && !path.isAbsolute(id),
    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      mainFiles: ['index'],
    },
    platform: 'neutral',
    // Required for re-export flattening. Safe here precisely because every file is an
    // entrypoint, which leaves treeshaking with nothing to remove.
    treeshake: true,
    plugins: [
      {
        name: 'code-infra-babel',
        async transform(code, id) {
          // Rolldown injects its own runtime module, which must not go through Babel.
          if (!path.isAbsolute(id) || !id.startsWith(sourceDir)) {
            return null;
          }

          const result = await babel.transformAsync(code, {
            configFile,
            filename: id,
            babelrc: false,
            envName,
            cwd,
            compact: hasLargeFiles ? false : 'auto',
            sourceMaps: false,
            // Added on top of the project's config, so metadata constants are inlined
            // regardless of the package's own Babel setup.
            plugins: [inlineMetadataConstants],
            // Lets configs that leave preset-env's `modules` at its default of "auto"
            // keep ES modules without relying on MUI_KEEP_ES_MODULES.
            caller: {
              name: 'code-infra-rolldown',
              supportsStaticESM: true,
              supportsDynamicImport: true,
            },
          });

          if (!result?.code) {
            throw new Error(`Babel produced no output for ${id}`);
          }

          return { code: result.code, map: result.map };
        },
      },
      preserveNamespaces({ verbose }),
    ],
  });

  await bundleHandle.write({
    dir: outDir,
    format: bundle === 'esm' ? 'esm' : 'cjs',
    // Every file is transpiled in place rather than bundled, so exports must keep the shape
    // Babel gives them: `exports.default` plus `__esModule`. The default of "auto" would
    // collapse a default-only module to `module.exports = value`, silently breaking
    // `require(...).default` for consumers.
    exports: 'named',
    preserveModules: true,
    preserveModulesRoot: sourceDir,
    // Under `preserveModules`, `[name]` is the module's path relative to
    // `preserveModulesRoot`, which reproduces the source tree in the output.
    entryFileNames: `[name]${outExtension}`,
    chunkFileNames: `[name]${outExtension}`,
    sourcemap: false,
    minify: false,
  });

  await bundleHandle.close();

  if (verbose) {
    console.log(
      `Inlined ${inlineStats.inlined} metadata constant reference(s) from ${constantsByModule.size} module(s).`,
    );
    console.log(`Bundled ${sourceFiles.length} files for "${bundle}".`);
  }
}

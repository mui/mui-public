import { nodeResolve } from '@rollup/plugin-node-resolve';
import replacePlugin from '@rollup/plugin-replace';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { rollup } from 'rollup';

import { getVersionEnvVariables } from '../utils/env.mjs';
import { BaseBundlerAdapter } from './base.mjs';
import { emitDeclarations } from '../../utils/typescript.mjs';

/**
 * @typedef {import('../types.mjs').BundlerConfig} BundlerConfig
 * @typedef {import('../types.mjs').BundlerType} BundlerType
 * @typedef {import('../types.mjs').Format} Format
 * @typedef {import('../types.mjs').OutputChunk} OutputChunk
 * @typedef {import('rollup').OutputOptions} OutputOptions
 * @typedef {import('rollup').RollupOptions} RollupOptions
 * @typedef {import('rollup').RollupOutput} RollupOutput
 * @typedef {import('rollup').OutputChunk} RollupOutputChunk
 */

export class Adapter extends BaseBundlerAdapter {
  /** @type {BundlerType} */
  name = 'rollup';

  /** @type {string | null} */
  tmpTsDir = null;

  /**
   * @param {BundlerConfig} config
   * @returns {Promise<OutputChunk[]>}
   */
  async build(config) {
    if (config.clean ?? true) {
      await fs.rm(config.outDir, { recursive: true, force: true });
      await fs.mkdir(config.outDir, { recursive: true });
    }
    /** @type {Record<string, string>} */
    const entries = {};
    for (const [key, value] of config.entries.entries()) {
      entries[key] = value.source;
    }

    if (config.tsconfigPath) {
      this.tmpTsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-bundler-'));
      await emitDeclarations(config.tsconfigPath, this.tmpTsDir, {
        useTsgo: config.tsgo,
      });
    }

    /** @type {Promise<{ format: Format; output: RollupOutput; forDts: boolean }>[]} */
    const promises = [];

    for (const forDts of [true, false]) {
      for (const format of config.formats) {
        promises.push(
          (async () => {
            const inputOptions = await this.getInputOptions(config, entries, format, forDts);
            const outputOptions = await this.getOutputOptions(config, format, forDts);
            const bundle = await rollup(inputOptions);
            const result = await bundle.write({
              ...outputOptions,
              importAttributesKey: 'with',
            });
            await bundle.close();
            return {
              format,
              forDts,
              output: result,
            };
          })(),
        );
      }
    }

    const results = await Promise.all(promises);
    if (this.tmpTsDir) {
      await fs.rm(this.tmpTsDir, { recursive: true, force: true });
      this.tmpTsDir = null;
    }

    return results.flatMap((res) => this.getOutputChunks(res.output, res.format, res.forDts));
  }

  /**
   * @private
   * @param {BundlerConfig} config
   * @param {Record<string, string>} entries
   * @param {Format} format
   * @param {boolean} [forDts]
   * @returns {Promise<RollupOptions>}
   */
  async getInputOptions(config, entries, format, forDts = false) {
    const plugins = await this.getPlugins(config, format, forDts);
    const externals = this.getExternalDependencies(config);
    const onwarn = config.verbose ? undefined : () => {};
    /**
     * @param {string} id
     * @returns {boolean}
     */
    const external = (id) => {
      if (id.startsWith('node:')) {
        return true;
      }
      // For .d.ts bundling, skip CSS files entirely
      if (forDts && id.endsWith('.css')) {
        return true;
      }
      // CSS files are external - they should be preserved as imports in the output
      // but their content should not be bundled
      if (id.endsWith('.css')) {
        return true;
      }
      return externals.some((dep) => id === dep || id.startsWith(`${dep}/`));
    };
    const inputEntries = forDts
      ? Object.fromEntries(
          Object.entries(entries).map(([key, value]) => [
            key,
            path.join(
              /** @type {string} */ (this.tmpTsDir),
              // Use [/\\] to match both forward and back slashes for cross-platform compatibility
              value.replace(/\.(ts|tsx)$/, '.d.ts').replace(/^(\.[/\\])?src[/\\]/, ''),
            ),
          ]),
        )
      : entries;
    /**
     * Determine if a module has side effects based on package.json sideEffects field.
     * CSS files are always treated as having side effects to preserve their imports.
     * @param {string} id - The module identifier
     * @returns {boolean}
     */
    const moduleSideEffects = (id) => {
      // CSS files always have side effects (they affect global styles)
      if (id.endsWith('.css')) {
        return true;
      }

      // If sideEffects is not defined, assume all modules have side effects
      if (config.packageInfo.sideEffects === undefined) {
        return true;
      }

      // If sideEffects is false, no modules have side effects
      if (config.packageInfo.sideEffects === false) {
        return false;
      }

      // If sideEffects is true, all modules have side effects
      if (config.packageInfo.sideEffects === true) {
        return true;
      }

      // If sideEffects is an array, check if the module matches any pattern
      if (Array.isArray(config.packageInfo.sideEffects)) {
        return config.packageInfo.sideEffects.some((pattern) => {
          // Handle glob patterns like "*.css"
          if (pattern.includes('*')) {
            const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
            // Check against the full path and just the filename
            const filename = id.split('/').pop() || id;
            return regex.test(id) || regex.test(filename);
          }
          return id === pattern || id.endsWith(pattern);
        });
      }

      return true;
    };

    return {
      input: inputEntries,
      external,
      onwarn,
      plugins,
      treeshake: {
        moduleSideEffects,
      },
    };
  }

  /**
   * @private
   * @param {BundlerConfig} config
   * @param {Format} format
   * @param {boolean} [forDts]
   * @returns {Promise<RollupOptions['plugins']>}
   */
  async getPlugins(config, format, forDts = false) {
    const fileExtensions = [
      '.mjs',
      '.js',
      '.json',
      '.node',
      '.jsx',
      '.cjs',
      '.ts',
      '.tsx',
      '.cts',
      '.mts',
      // Base UI specific
      '.parts.ts',
      '.parts.tsx',
    ];
    if (forDts) {
      fileExtensions.push('.d.ts');
    }
    /** @type {import('rollup').Plugin[]} */
    const plugins = [
      /** @type {import('rollup').Plugin} */ (
        nodeResolve({
          extensions: fileExtensions,
        })
      ),
    ];

    if (!forDts && (config.babelConfigPath || config.enableReactCompiler)) {
      const { babelPlugin } = await import('./babel-plugin.mjs');
      plugins.push(babelPlugin(config, { format }));
    }
    if (forDts && config.tsconfigPath) {
      const { dts: pluginDts } = await import('rollup-plugin-dts');
      plugins.push(
        /** @type {import('rollup').Plugin} */ (
          pluginDts({
            respectExternal: true,
            tsconfig: config.tsconfigPath,
          })
        ),
      );
    }
    plugins.push(
      /** @type {import('rollup').Plugin} */ (
        replacePlugin({
          'process.env.MUI_BUILD': JSON.stringify('1'),
          'import.meta.env.MUI_BUILD': JSON.stringify('1'),
          ...getVersionEnvVariables(config.packageInfo.version),
          sourceMap: config.sourceMap ?? false,
          preventAssignment: true,
        })
      ),
    );
    if (!forDts) {
      const { preserveDirectives } = await import('rollup-plugin-preserve-directives');
      plugins.push(preserveDirectives());
    }
    // Replace Rollup's inline interop helpers with imports from @babel/runtime
    // This must run after all other plugins that might generate CJS output
    if (!forDts && format === 'cjs') {
      const { babelRuntimeInteropPlugin } = await import('./babel-runtime-interop-plugin.mjs');
      plugins.push(babelRuntimeInteropPlugin());
    }
    return plugins;
  }

  /**
   * @private
   * @param {BundlerConfig} config
   * @param {Format} format
   * @param {boolean} [forDts]
   * @returns {Promise<OutputOptions>}
   */
  async getOutputOptions(config, format, forDts = false) {
    const isTypeModule = config.packageInfo.type === 'module';
    let dtsExtension = 'ts';
    let jsExtension = 'js';
    if (isTypeModule) {
      if (format === 'cjs') {
        dtsExtension = 'cts';
        jsExtension = 'cjs';
      }
    } else if (format === 'esm') {
      dtsExtension = 'mts';
      jsExtension = 'mjs';
    }
    const srcDir = path.join(config.cwd, 'src');
    const isSrcDirPresent = await fs.stat(srcDir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    const baseDirectory = isSrcDirPresent ? srcDir : config.cwd;
    // When preserveModules is true, non-entry modules from .d.ts files already have .d in their name
    // (e.g., types.d.ts becomes [name]=types.d), so we only add .d for actual entry points
    const entryFileNames = forDts
      ? (/** @type {{ name: string }} */ chunkInfo) => {
          if (chunkInfo.name.endsWith('.d')) {
            return `[name].${dtsExtension}`;
          }
          return `[name].d.${dtsExtension}`;
        }
      : `[name].${jsExtension}`;
    const chunkFileNames = forDts ? `[name].${dtsExtension}` : `[name]-[hash].${jsExtension}`;
    return {
      dir: config.outDir,
      format,
      sourcemap: config.sourceMap,
      banner: this.getBanner(config),
      preserveModules: config.preserveDirectory,
      // eslint-disable-next-line no-nested-ternary
      preserveModulesRoot: config.preserveDirectory
        ? forDts
          ? baseDirectory
          : /** @type {string} */ (this.tmpTsDir)
        : undefined,
      // Prevent Rollup from hoisting transitive imports through barrel files,
      // which would create unnecessary side-effect imports
      hoistTransitiveImports: config.preserveDirectory ? false : undefined,
      // Add Object.defineProperty(exports, '__esModule', { value: true }) to CJS output
      // so other bundlers/tools know this was originally an ES module
      esModule: format === 'cjs',
      // Use 'named' exports for CJS to emit 'exports.default =' instead of 'module.exports ='
      // This matches the 'export default' in .d.ts files and avoids FalseExportDefault errors
      exports: format === 'cjs' ? 'named' : undefined,
      // Use 'compat' interop which generates a helper that checks for __esModule.
      // We then replace Rollup's inline helper with an import from @babel/runtime.
      interop: 'compat',
      entryFileNames,
      chunkFileNames,
    };
  }

  /**
   * @private
   * @param {RollupOutput} result
   * @param {Format} format
   * @param {boolean} [forDts]
   * @returns {OutputChunk[]}
   */
  getOutputChunks(result, format, forDts = false) {
    return result.output
      .filter(
        /** @returns {chunk is RollupOutputChunk} */
        (chunk) => chunk.type === 'chunk' && !!chunk.facadeModuleId && chunk.isEntry,
      )
      .map((chunk) => ({
        // eslint-disable-next-line no-nested-ternary
        name: forDts ? (chunk.name.endsWith('.d') ? chunk.name : `${chunk.name}.d`) : chunk.name,
        outputFile: chunk.fileName,
        format,
      }));
  }
}

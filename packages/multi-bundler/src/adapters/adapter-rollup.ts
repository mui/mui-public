import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import type {
  OutputOptions,
  RollupOptions,
  RollupOutput,
  OutputChunk as RollupOutputChunk,
} from 'rollup';
import { rollup } from 'rollup';
import type { BundlerConfig, BundlerType, Format } from '../types';
import type { OutputChunk } from '../utils/generate-exports-field';
import { BaseBundlerAdapter } from './base';

export class Adapter extends BaseBundlerAdapter {
  name: BundlerType = 'rollup';

  async build(config: BundlerConfig): Promise<OutputChunk[]> {
    if (config.clean ?? true) {
      await fs.rm(config.outDir, { recursive: true, force: true });
    }
    const entries = Array.from(config.entries.entries()).reduce(
      (acc, [key, value]) => {
        acc[key] = value.source;
        return acc;
      },
      {} as Record<string, string>,
    );
    const outputs: OutputChunk[] = [];

    /* eslint-disable no-await-in-loop */
    for (const format of config.formats) {
      const inputOptions = await this.getInputOptions(config, entries, format);
      const outputOptions = await this.getOutputOptions(config, format);
      const bundle = await rollup(inputOptions);
      const result = await bundle.write(outputOptions);
      outputs.push(...this.getOutputChunks(result, format));
      await bundle.close();
    }
    /* eslint-enable no-await-in-loop */

    return outputs;
  }

  private async getInputOptions(
    config: BundlerConfig,
    entries: Record<string, string>,
    format: Format,
  ): Promise<RollupOptions> {
    const plugins = await this.getPlugins(config, format);
    const externals = this.getExternalDependencies(config);
    const onwarn = config.verbose ? undefined : () => {};
    const external = (id: string): boolean => {
      if (id.startsWith('node:')) {
        return true;
      }
      return externals.some((dep) => id === dep || id.startsWith(`${dep}/`));
    };

    return {
      input: entries,
      external,
      onwarn,
      plugins,
    };
  }

  private async getPlugins(
    config: BundlerConfig,
    format: Format,
  ): Promise<RollupOptions['plugins']> {
    const plugins: RollupOptions['plugins'] = [
      // Only added to resolve index.parts files in Base UI
      nodeResolve({
        extensions: [
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
          '.parts.ts',
          '.parts.tsx',
        ],
      }),
    ];
    if (config.babelConfigPath || config.enableReactCompiler) {
      const { babelPlugin } = await import('./babel-plugin');
      plugins.push(babelPlugin(config, { format }));
    }
    return plugins;
  }

  private async getOutputOptions(config: BundlerConfig, format: Format): Promise<OutputOptions> {
    const extension = format === 'esm' ? 'mjs' : 'cjs';
    const srcDir = path.join(config.cwd, 'src');
    const isSrcDirPresent = await fs.stat(srcDir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    const baseDirectory = isSrcDirPresent ? srcDir : config.cwd;
    return {
      dir: config.outDir,
      format,
      sourcemap: config.sourceMap,
      banner: this.getBanner(config),
      preserveModules: config.preserveDirectory,
      preserveModulesRoot: config.preserveDirectory ? baseDirectory : undefined,
      entryFileNames: `[name].${extension}`,
      chunkFileNames: `[name]-[hash].${extension}`,
    };
  }

  private getOutputChunks(result: RollupOutput, format: Format): OutputChunk[] {
    return result.output
      .filter((chunk): chunk is RollupOutputChunk => chunk.type === 'chunk' && chunk.isEntry)
      .map((chunk) => ({
        name: chunk.name,
        outputFile: chunk.fileName,
        format,
      }));
  }
}

import { nodeResolve } from '@rollup/plugin-node-resolve';
import replacePlugin from '@rollup/plugin-replace';
import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
import { getVersionEnvVariables } from '../utils/env';

const $$ = $({ stdio: 'inherit' });

/**
 * Emits TypeScript declaration files.
 */
export async function emitDeclarations(tsconfig: string, outDir: string) {
  const tsconfigDir = path.dirname(tsconfig);
  const rootDir = path.resolve(tsconfigDir, './src');
  await $$`tsc
    -p ${tsconfig}
    --rootDir ${rootDir}
    --outDir ${outDir}
    --declaration
    --emitDeclarationOnly
    --noEmit false
    --composite false
    --incremental false
    --declarationMap false`;
}

export class Adapter extends BaseBundlerAdapter {
  name: BundlerType = 'rollup';

  private tmpTsDir: string | null = null;

  async build(config: BundlerConfig): Promise<OutputChunk[]> {
    if (config.clean ?? true) {
      await fs.rm(config.outDir, { recursive: true, force: true });
      await fs.mkdir(config.outDir, { recursive: true });
    }
    const entries = Array.from(config.entries.entries()).reduce(
      (acc, [key, value]) => {
        acc[key] = value.source;
        return acc;
      },
      {} as Record<string, string>,
    );

    if (config.tsconfigPath) {
      this.tmpTsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-infra-bundler-'));
      await emitDeclarations(config.tsconfigPath, this.tmpTsDir);
    }

    const promises: Promise<{
      format: Format;
      output: RollupOutput;
      forDts: boolean;
    }>[] = [];

    [true, false].forEach((forDts) => {
      for (const format of config.formats) {
        promises.push(
          (async () => {
            const inputOptions = await this.getInputOptions(config, entries, format, forDts);
            const outputOptions = await this.getOutputOptions(config, format, forDts);
            const bundle = await rollup(inputOptions);
            const result = await bundle.write(outputOptions);
            await bundle.close();
            return {
              format,
              forDts,
              output: result,
            };
          })(),
        );
      }
    });

    const results = await Promise.all(promises);
    if (this.tmpTsDir) {
      await fs.rm(this.tmpTsDir, { recursive: true, force: true });
      this.tmpTsDir = null;
    }

    return results.flatMap((res) => this.getOutputChunks(res.output, res.format, res.forDts));
  }

  private async getInputOptions(
    config: BundlerConfig,
    entries: Record<string, string>,
    format: Format,
    forDts = false,
  ): Promise<RollupOptions> {
    const plugins = await this.getPlugins(config, format, forDts);
    const externals = this.getExternalDependencies(config);
    const onwarn = config.verbose ? undefined : () => {};
    const external = (id: string): boolean => {
      if (id.startsWith('node:')) {
        return true;
      }
      return externals.some((dep) => id === dep || id.startsWith(`${dep}/`));
    };
    const inputEntries = forDts
      ? Object.fromEntries(
          Object.entries(entries).map(([key, value]) => [
            key,
            path.join(
              this.tmpTsDir as string,
              value.replace(/\.(ts|tsx)$/, '.d.ts').replace(/^(\.\/)?src\//, ''),
            ),
          ]),
        )
      : entries;
    return {
      input: inputEntries,
      external,
      onwarn,
      plugins,
    };
  }

  private async getPlugins(
    config: BundlerConfig,
    format: Format,
    forDts = false,
  ): Promise<RollupOptions['plugins']> {
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
    const plugins: RollupOptions['plugins'] = [
      nodeResolve({
        extensions: fileExtensions,
      }),
    ];
    if (!forDts && (config.babelConfigPath || config.enableReactCompiler)) {
      const { babelPlugin } = await import('./babel-plugin');
      plugins.push(babelPlugin(config, { format }));
    }
    if (forDts && config.tsconfigPath) {
      const { dts: pluginDts } = await import('rollup-plugin-dts');
      plugins.push(
        pluginDts({
          respectExternal: true,
          tsconfig: config.tsconfigPath,
        }),
      );
    }
    plugins.push(
      replacePlugin({
        'process.env.MUI_BUILD': JSON.stringify('1'),
        'import.meta.env.MUI_BUILD': JSON.stringify('1'),
        ...getVersionEnvVariables(config.packageInfo.version),
        sourceMap: config.sourceMap ?? false,
        preventAssignment: true,
      }),
    );
    return plugins;
  }

  private async getOutputOptions(
    config: BundlerConfig,
    format: Format,
    forDts = false,
  ): Promise<OutputOptions> {
    const dtsExtension = format === 'esm' ? 'mts' : 'cts';
    const jsExtension = format === 'esm' ? 'mjs' : 'cjs';
    const srcDir = path.join(config.cwd, 'src');
    const isSrcDirPresent = await fs.stat(srcDir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    const baseDirectory = isSrcDirPresent ? srcDir : config.cwd;
    const entryFileNames = forDts ? `[name].d.${dtsExtension}` : `[name].${jsExtension}`;
    const chunkFileNames = forDts ? `[name]-[hash][extname]` : `[name]-[hash].${jsExtension}`;
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
          : (this.tmpTsDir as string)
        : undefined,
      entryFileNames,
      chunkFileNames,
    };
  }

  private getOutputChunks(result: RollupOutput, format: Format, forDts = false): OutputChunk[] {
    return result.output
      .filter(
        (chunk): chunk is RollupOutputChunk =>
          chunk.type === 'chunk' && !!chunk.facadeModuleId && chunk.isEntry,
      )
      .map((chunk) => ({
        // eslint-disable-next-line no-nested-ternary
        name: forDts ? (chunk.name.endsWith('.d') ? chunk.name : `${chunk.name}.d`) : chunk.name,
        outputFile: chunk.fileName,
        format,
      }));
  }
}

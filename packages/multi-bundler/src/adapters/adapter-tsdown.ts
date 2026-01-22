import { InlineConfig, build as tsdown } from 'tsdown';
import type { BundlerConfig, BundlerType, Format } from '../types';
import { type OutputChunk } from '../utils/generate-exports-field';
import { BaseBundlerAdapter } from './base';

export class Adapter extends BaseBundlerAdapter {
  name: BundlerType = 'tsdown';

  async build(config: BundlerConfig): Promise<OutputChunk[]> {
    const entries = Array.from(config.entries.entries()).reduce(
      (acc, [key, value]) => {
        acc[key] = value.source;
        return acc;
      },
      {} as Record<string, string>,
    );
    const commonConfig: InlineConfig = {
      clean: true,
      entry: entries,
      outDir: config.outDir,
      sourcemap: config.sourceMap,
      dts: config.tsconfigPath
        ? {
            tsconfig: config.tsconfigPath,
            sourcemap: config.sourceMap || false,
            compilerOptions: {
              jsx: 'react-jsx',
            },
          }
        : false,
      watch: config.watch || false,
      logLevel: config.verbose ? 'info' : 'silent',
      skipNodeModulesBundle: true,
      banner: {
        js: this.getBanner(config),
      },
      unbundle: config.preserveDirectory,
      env: {
        MULTI_BUNDLER: '1',
        MULTI_BUNDLER_WHAT: 'tsdown',
      },
    };
    const res = await Promise.all(
      config.formats.map((format) =>
        tsdown({
          ...commonConfig,
          format,
          plugins:
            config.babelConfigPath || config.enableReactCompiler
              ? (async () => {
                  const { babelPlugin } = await import('./babel-plugin');
                  return [babelPlugin(config, { format })];
                })()
              : [],
        }),
      ),
    );

    const outputs: OutputChunk[] = res
      .flatMap((r) => r[0])
      .flatMap((r) =>
        r.chunks
          .filter((c) => c.type === 'chunk' && c.facadeModuleId && c.isEntry)
          .map((c) => ({
            name: c.name as string,
            outputFile: c.fileName,
            format: (r.config.format === 'es' ? 'esm' : r.config.format) as Format,
          })),
      );
    return outputs;
  }
}

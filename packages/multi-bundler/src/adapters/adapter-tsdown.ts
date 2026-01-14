import { build as tsdown } from 'tsdown';
import type { BundlerConfig, BundlerType, Format } from '../types';
import { generateExportsField, type OutputChunk } from '../utils/generate-exports-field';
import { BaseBundlerAdapter, type BundlerOutput } from './base';

export class Adapter extends BaseBundlerAdapter {
  name: BundlerType = 'tsdown';

  async build(config: BundlerConfig): Promise<BundlerOutput> {
    const entries = Array.from(config.entries.entries()).reduce(
      (acc, [key, value]) => {
        acc[key] = value.source;
        return acc;
      },
      {} as Record<string, string>,
    );
    const res = await tsdown({
      clean: true,
      entry: entries,
      outDir: config.outDir,
      format: config.formats,
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
    });
    const outputs: OutputChunk[] = res.flatMap((r) =>
      r.chunks
        .filter((c) => c.type === 'chunk' && c.facadeModuleId)
        .map((c) => ({
          name: c.name as string,
          outputFile: c.fileName,
          format: (r.config.format === 'es' ? 'esm' : r.config.format) as Format,
        })),
    );
    return generateExportsField(outputs, config.entries);
  }
}

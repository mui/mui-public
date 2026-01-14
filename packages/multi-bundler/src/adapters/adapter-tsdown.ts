import * as semver from 'semver';
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
                  let babelRuntimeVersion =
                    config.packageInfo.dependencies?.['@babel/runtime'] ?? '';
                  if (babelRuntimeVersion === 'catalog:') {
                    // @TODO: improve this by reading from the workspace package.json
                    babelRuntimeVersion = '^7.25.0';
                  }

                  if (!babelRuntimeVersion) {
                    throw new Error(
                      'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
                    );
                  }
                  let reactVersion = '';
                  if (config.enableReactCompiler) {
                    reactVersion =
                      semver.minVersion(config.packageInfo.peerDependencies?.react || '')
                        ?.version ?? 'latest';
                    const mode = process.env.REACT_COMPILER_MODE ?? 'opt-in';
                    // eslint-disable-next-line no-console
                    console.log(
                      `[feature] Building with React compiler enabled. The compiler mode is "${mode}" right now.${mode === 'opt-in' ? ' Use explicit "use memo" directives in your components to enable the React compiler for them.' : ''}`,
                    );
                  }
                  const { default: pluginBabel } = await import('@rollup/plugin-babel');
                  return [
                    pluginBabel({
                      babelHelpers: 'runtime',
                      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.cjs', '.cts'],
                      skipPreflightCheck: true,
                      configFile: config.babelConfigPath,
                      parserOpts: {
                        sourceType: 'module',
                        plugins: ['jsx', 'typescript'],
                      },
                      envName: format === 'cjs' ? 'node' : 'stable',
                      caller: {
                        name: 'tsdown-bundler',
                        babelRuntimeVersion,
                        reactCompilerReactVersion: reactVersion,
                        optimizeClsx:
                          config.packageInfo.dependencies?.clsx !== undefined ||
                          config.packageInfo.dependencies?.classnames !== undefined,
                        removePropTypes:
                          config.packageInfo.dependencies?.['prop-types'] !== undefined,
                      } as any,
                    }),
                  ];
                })()
              : [],
        }),
      ),
    );

    const outputs: OutputChunk[] = res
      .flatMap((r) => r[0])
      .flatMap((r) =>
        r.chunks
          .filter((c) => c.type === 'chunk' && c.facadeModuleId)
          .map((c) => ({
            name: c.name as string,
            outputFile: c.fileName,
            format: (r.config.format === 'es' ? 'esm' : r.config.format) as Format,
          })),
      );
    return outputs;
  }
}

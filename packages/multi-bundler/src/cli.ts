/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import pc from 'picocolors';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { build, type BundleFormat } from './builder';
import type { BundlerType, PackageInfo } from './types';
import type { GeneratedExports } from './utils/generate-exports-field';

function formatConditionValue(
  value: unknown,
  indent: string,
  conditionName: string,
  lines: string[],
): void {
  if (typeof value === 'string') {
    lines.push(`${indent}${pc.dim(conditionName)}: ${value}`);
  } else if (typeof value === 'object' && value !== null) {
    const nested = value as Record<string, unknown>;
    // Check if it's a {types, default} object or nested conditions
    if (nested.types && nested.default && Object.keys(nested).length === 2) {
      lines.push(`${indent}${pc.dim(conditionName)}:`);
      lines.push(`${indent}  ${pc.dim('types')}: ${nested.types}`);
      lines.push(`${indent}  ${pc.dim('default')}: ${nested.default}`);
    } else {
      // It's a nested condition (like react-server containing import/require)
      lines.push(`${indent}${pc.yellow(conditionName)}:`);
      for (const [nestedCond, nestedValue] of Object.entries(nested)) {
        formatConditionValue(nestedValue, `${indent}  `, nestedCond, lines);
      }
    }
  }
}

function formatExportsOutput(result: GeneratedExports): string {
  const lines: string[] = [];

  if (typeof result.exports === 'object' && Object.keys(result.exports).length > 0) {
    lines.push(pc.bold('Exports:'));
    for (const [exportPath, conditions] of Object.entries(result.exports)) {
      lines.push(`  ${pc.cyan(exportPath)}`);
      if (conditions && typeof conditions === 'object') {
        for (const [condition, value] of Object.entries(conditions)) {
          formatConditionValue(value, '    ', condition, lines);
        }
      }
    }
  }

  if (result.bin && (typeof result.bin === 'string' || Object.keys(result.bin).length > 0)) {
    lines.push(pc.bold('Bin:'));
    if (typeof result.bin === 'string') {
      lines.push(`  ${result.bin}`);
    } else {
      for (const [name, binPath] of Object.entries(result.bin)) {
        lines.push(`  ${pc.cyan(name)}: ${binPath}`);
      }
    }
  }

  return lines.join('\n');
}

yargs()
  .scriptName('code-infra-bundler')
  .usage('$0 [args]')
  .strict()
  .help()
  .command({
    command: '$0',
    builder: (y) =>
      y
        .option('bundler', {
          describe: 'The underlying bundler to use',
          type: 'string',
          choices: ['tsdown', 'rolldown', 'rollup'],
          default: 'rollup',
        })
        .option('outDir', {
          describe: 'Output directory. Default "dist"',
          type: 'string',
        })
        .option('format', {
          describe: 'Bundle format',
          type: 'string',
          choices: ['esm', 'cjs', 'both'],
          default: 'both',
        })
        .option('watch', {
          describe: 'Watch mode',
          type: 'boolean',
          default: false,
        })
        .option('sourceMap', {
          describe: 'Generate source maps',
          type: 'boolean',
          default: false,
        })
        .option('cwd', {
          describe: 'Working directory',
          type: 'string',
          default: process.cwd(),
        })
        .option('verbose', {
          describe: 'Enable verbose logging',
          type: 'boolean',
          default: false,
        })
        .option('preserveDirectory', {
          describe: 'Preserve directory structure in output',
          type: 'boolean',
          default: true,
        })
        .option('writePkgJson', {
          describe: 'Write package.json to output directory',
          type: 'boolean',
        })
        .option('enableReactCompiler', {
          describe: 'Enable React specific compilation features',
          type: 'boolean',
          default: false,
        }),
    async handler({ _: _raw, $0: __raw, writePkgJson, ...args }) {
      const startTime = performance.now();

      let outDir = args.outDir as string | undefined;
      let shouldWritePkgJson = writePkgJson;

      const pkgJson = JSON.parse(
        await fs.readFile(path.join(args.cwd, 'package.json'), 'utf-8'),
      ) as PackageInfo;

      if (pkgJson.publishConfig && pkgJson.publishConfig.directory) {
        outDir = pkgJson.publishConfig.directory as string;
        shouldWritePkgJson = typeof shouldWritePkgJson === 'boolean' ? shouldWritePkgJson : true;
      }

      const formats = args.format === 'both' ? ['esm', 'cjs'] : [args.format];

      console.log(
        `${pc.bold(pc.blue('multi-bundler'))} ${pc.dim(`using ${pc.bold(args.bundler)}`)}`,
      );
      console.log();
      console.log(
        `${pc.dim('Package:')}  ${pc.bold(pkgJson.name)} ${pc.dim(`v${pkgJson.version}`)}`,
      );
      outDir = outDir ?? 'dist';
      console.log(`${pc.dim('Outdir:')}   ${pc.yellow(outDir)}`);
      console.log(`${pc.dim('Formats:')}  ${formats.map((f: string) => pc.magenta(f)).join(', ')}`);
      console.log();

      try {
        const res = await build({
          ...args,
          bundler: args.bundler as BundlerType,
          outDir,
          format: args.format as BundleFormat,
          cwd: args.cwd,
        });

        if (shouldWritePkgJson) {
          pkgJson.exports = res.exports ?? {};
          pkgJson.exports = {
            './package.json': './package.json',
            ...pkgJson.exports,
          };
          if (res.bin) {
            pkgJson.bin = res.bin;
          }
          // keep all the install hook related scripts
          if (pkgJson.scripts) {
            for (const key of Object.keys(pkgJson.scripts)) {
              if (
                key.startsWith('install') ||
                key.startsWith('preinstall') ||
                key.startsWith('postinstall')
              ) {
                continue;
              }
              delete pkgJson.scripts[key];
            }
          }
          delete pkgJson.devDependencies;
          delete pkgJson.publishConfig?.directory;

          await fs.writeFile(
            path.join(args.cwd, outDir, 'package.json'),
            `${JSON.stringify(pkgJson, null, 2)}\n`,
            'utf-8',
          );

          console.log(pc.green('✓') + pc.bold(' package.json written to output directory'));
        }

        const duration = ((performance.now() - startTime) / 1000).toFixed(2);

        console.log(pc.green('✓') + pc.bold(' Build completed ') + pc.dim(`in ${duration}s`));
        console.log();
        if (args.verbose) {
          console.log(formatExportsOutput(res));
          console.log();
        }
      } catch (error) {
        console.error(pc.red('✗') + pc.bold(' Build failed'));
        console.error(pc.red((error as Error).message));
        throw error;
      }
    },
  })
  .help()
  .parse(hideBin(process.argv));

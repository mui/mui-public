/* eslint-disable no-console */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { build } from '../bundler/builder.mjs';

/**
 * @typedef {import('../bundler/types.mjs').BundlerType} BundlerType
 * @typedef {import('../bundler/types.mjs').PackageInfo} PackageInfo
 * @typedef {import('../bundler/types.mjs').GeneratedExports} GeneratedExports
 * @typedef {import('../bundler/builder.mjs').BundleFormat} BundleFormat
 */

/**
 * @typedef {Object} Args
 * @property {BundlerType} bundler - The underlying bundler to use
 * @property {string} [outDir] - Output directory. Default "dist"
 * @property {BundleFormat} format - Bundle format
 * @property {boolean} watch - Watch mode
 * @property {boolean} sourceMap - Generate source maps
 * @property {string} cwd - Working directory
 * @property {boolean} verbose - Enable verbose logging
 * @property {boolean} preserveDirectory - Preserve directory structure in output
 * @property {boolean} [writePkgJson] - Write package.json to output directory
 * @property {boolean} enableReactCompiler - Enable React specific compilation features
 */

/**
 * @param {unknown} value
 * @param {string} indent
 * @param {string} conditionName
 * @param {string[]} lines
 * @returns {void}
 */
function formatConditionValue(value, indent, conditionName, lines) {
  if (typeof value === 'string') {
    lines.push(`${indent}${chalk.dim(conditionName)}: ${value}`);
  } else if (typeof value === 'object' && value !== null) {
    const nested = /** @type {Record<string, unknown>} */ (value);
    // Check if it's a {types, default} object or nested conditions
    if (nested.types && nested.default && Object.keys(nested).length === 2) {
      lines.push(`${indent}${chalk.dim(conditionName)}:`);
      lines.push(`${indent}  ${chalk.dim('types')}: ${nested.types}`);
      lines.push(`${indent}  ${chalk.dim('default')}: ${nested.default}`);
    } else {
      // It's a nested condition (like react-server containing import/require)
      lines.push(`${indent}${chalk.yellow(conditionName)}:`);
      for (const [nestedCond, nestedValue] of Object.entries(nested)) {
        formatConditionValue(nestedValue, `${indent}  `, nestedCond, lines);
      }
    }
  }
}

/**
 * @param {GeneratedExports} result
 * @returns {string}
 */
function formatExportsOutput(result) {
  /** @type {string[]} */
  const lines = [];

  if (typeof result.exports === 'object' && Object.keys(result.exports).length > 0) {
    lines.push(chalk.bold('Exports:'));
    for (const [exportPath, conditions] of Object.entries(result.exports)) {
      lines.push(`  ${chalk.cyan(exportPath)}`);
      if (conditions && typeof conditions === 'object') {
        for (const [condition, value] of Object.entries(conditions)) {
          formatConditionValue(value, '    ', condition, lines);
        }
      }
    }
  }

  if (result.bin && (typeof result.bin === 'string' || Object.keys(result.bin).length > 0)) {
    lines.push(chalk.bold('Bin:'));
    if (typeof result.bin === 'string') {
      lines.push(`  ${result.bin}`);
    } else {
      for (const [name, binPath] of Object.entries(result.bin)) {
        lines.push(`  ${chalk.cyan(name)}: ${binPath}`);
      }
    }
  }

  return lines.join('\n');
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'bundle',
  builder: (yargs) =>
    yargs
      .option('bundler', {
        describe: 'The underlying bundler to use',
        type: 'string',
        // only options for now
        choices: ['rollup'],
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

    let outDir = /** @type {string | undefined} */ (args.outDir);
    let shouldWritePkgJson = writePkgJson;

    /** @type {PackageInfo} */
    const pkgJson = JSON.parse(await fs.readFile(path.join(args.cwd, 'package.json'), 'utf-8'));

    if (pkgJson.publishConfig && pkgJson.publishConfig.directory) {
      outDir = /** @type {string} */ (pkgJson.publishConfig.directory);
      shouldWritePkgJson = typeof shouldWritePkgJson === 'boolean' ? shouldWritePkgJson : true;
    }

    const formats = args.format === 'both' ? ['esm', 'cjs'] : [args.format];

    console.log(
      `${chalk.bold(chalk.blue('code-infra-bundler'))} ${chalk.dim(`using ${chalk.bold(args.bundler)}`)}`,
    );
    console.log();
    console.log(
      `${chalk.dim('Package:')}  ${chalk.bold(pkgJson.name)}@${chalk.dim(`v${pkgJson.version}`)}`,
    );
    outDir = outDir ?? 'dist';
    console.log(`${chalk.dim('Outdir:')}   ${chalk.yellow(outDir)}`);
    console.log(
      `${chalk.dim('Formats:')}  ${formats.map((/** @type {string} */ f) => chalk.magenta(f)).join(', ')}`,
    );
    console.log();

    try {
      const res = await build({
        ...args,
        bundler: /** @type {BundlerType} */ (args.bundler),
        outDir,
        format: /** @type {BundleFormat} */ (args.format),
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

        console.log(chalk.green('✓') + chalk.bold(' package.json written to output directory'));
      }

      const duration = ((performance.now() - startTime) / 1000).toFixed(2);

      console.log(
        chalk.green('✓') + chalk.bold(' Build completed ') + chalk.dim(`in ${duration}s`),
      );
      console.log();
      if (args.verbose) {
        console.log(formatExportsOutput(res));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('✗') + chalk.bold(' Build failed'));
      console.error(chalk.red(/** @type {Error} */ (error).message));
      throw error;
    }
  },
});

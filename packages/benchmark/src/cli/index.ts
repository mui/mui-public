#!/usr/bin/env node

import { createRequire } from 'node:module';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdTacho from './cmdTacho';

// Self-referencing, not a relative path: this file sits at `src/cli/` in the repository but at
// `cli/` in the published package, which is built from `build/`, so no single relative path
// reaches the manifest in both layouts.
const pkgJson = createRequire(import.meta.url)('@mui/internal-benchmark/package.json');

let globalArgv: { verbose?: boolean } = {};

await yargs(hideBin(process.argv))
  .scriptName('benchmark')
  .usage('$0 <command> [args]')
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Increase output verbosity',
    global: true,
  })
  .middleware((argv) => {
    globalArgv = argv;
  }, true)
  .command(cmdTacho)
  .fail((msg, err, yargsInstance) => {
    if (msg) {
      yargsInstance.showHelp();
      console.error(`\n${msg}`);
    } else if (err) {
      console.error(err.message);
      if (globalArgv.verbose) {
        console.error(chalk.dim(err.stack));
      }
    }
    process.exit(1);
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  .version(pkgJson.version)
  .parseAsync();

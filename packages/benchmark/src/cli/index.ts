#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdTacho from './cmdTacho';
import { ownPackage } from '../utils/ownPackage';

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
  .version(ownPackage.version)
  .parseAsync();

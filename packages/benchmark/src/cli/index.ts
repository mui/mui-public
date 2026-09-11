#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Self-referencing rather than `../../package.json`: this file is one directory deeper in the
// repository than in the published package, which is built from `build/`, so a relative path
// cannot reach the manifest from both — and the repository's workspace symlink hides the break.
import pkgJson from '@mui/internal-benchmark/package.json' with { type: 'json' };
import tachoReport from './tachoReport';
import tachoRun from './tachoRun';

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
  .command({
    command: 'tacho <command>',
    describe: 'Benchmark a tachometer harness, and read the reports it writes.',
    builder: (group) =>
      group.command(tachoRun).command(tachoReport).demandCommand(1, 'Specify a tacho subcommand.'),
    // The group itself does nothing; `demandCommand` above means a subcommand always runs.
    handler: () => {},
  })
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

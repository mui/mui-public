import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import cmdPostBuild from './cmdPostBuild';

const pkgJson = createRequire(import.meta.url)('../../package.json');

yargs()
  .scriptName('docs-infra')
  .usage('$0 <command> [args]')
  .command(cmdPostBuild)
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  .version(pkgJson.version)
  .parse(hideBin(process.argv));

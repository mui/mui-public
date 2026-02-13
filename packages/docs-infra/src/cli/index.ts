import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import runValidate from './runValidate';

yargs()
  .scriptName('docs-infra')
  .usage('$0 <command> [args]')
  .command(runValidate)
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  .version(process.env.MUI_VERSION || createRequire(import.meta.url)('../../package.json').version)
  .parse(hideBin(process.argv));

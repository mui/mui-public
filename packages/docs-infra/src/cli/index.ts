import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import runValidate from './runValidate';

function getVersion() {
  return createRequire(import.meta.url)('../../package.json').version;
}

yargs()
  .scriptName('docs-infra')
  .usage('$0 <command> [args]')
  .command(runValidate)
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  // MUI_VERSION is set through the code-infra build command.
  .version(process.env.MUI_VERSION || getVersion())
  .parse(hideBin(process.argv));

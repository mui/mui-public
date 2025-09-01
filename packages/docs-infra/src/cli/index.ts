import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import runValidate from './runValidate';

export function runCli() {
  const { version } = createRequire(import.meta.url)(
    process.env.MUI_VERSION ? '../package.json' : '../../package.json',
  );

  yargs()
    .scriptName('docs-infra')
    .usage('$0 <command> [args]')
    .command(runValidate)
    .demandCommand(1, 'You need at least one command before moving on')
    .strict()
    .help()
    .version(version)
    .parse(hideBin(process.argv));
}

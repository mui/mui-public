import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdArgosPush from './cmdArgosPush.mjs';
import cmdBuild from './cmdBuild.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdExtractErrorCodes from './cmdExtractErrorCodes.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdSetVersionOverrides from './cmdSetVersionOverrides.mjs';

const pkgJson = createRequire(import.meta.url)('../../package.json');

yargs()
  .scriptName('code-infra')
  .usage('$0 <command> [args]')
  .command(cmdArgosPush)
  .command(cmdBuild)
  .command(cmdCopyFiles)
  .command(cmdExtractErrorCodes)
  .command(cmdJsonLint)
  .command(cmdListWorkspaces)
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdSetVersionOverrides)
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  .version(pkgJson.version)
  .parse(hideBin(process.argv));

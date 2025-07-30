import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdArgosPush from './cmdArgosPush.mjs';
import cmdBuild from './cmdBuild.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdSetVersionOverrides from './cmdSetVersionOverrides.mjs';

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdListWorkspaces)
  .command(cmdJsonLint)
  .command(cmdArgosPush)
  .command(cmdSetVersionOverrides)
  .command(cmdCopyFiles)
  .command(cmdBuild)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse(hideBin(process.argv));

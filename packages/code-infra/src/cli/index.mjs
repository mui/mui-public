import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdJsonLint from './cmdJsonLint.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdReleaseTag from './cmdReleaseTag.mjs';

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdListWorkspaces)
  .command(cmdJsonLint)
  .command(cmdReleaseTag)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse(hideBin(process.argv));

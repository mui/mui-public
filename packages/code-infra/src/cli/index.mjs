import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';
import cmdArgosPush from './cmdArgosPush.mjs';

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdListWorkspaces)
  .command(cmdJsonLint)
  .command(cmdArgosPush)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse(hideBin(process.argv));

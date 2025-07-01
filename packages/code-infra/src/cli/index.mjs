import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdListWorkspaces)
  .help()
  .parse(hideBin(process.argv));

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdJsonLint)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse(hideBin(process.argv));

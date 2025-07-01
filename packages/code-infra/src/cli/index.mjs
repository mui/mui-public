import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';

yargs().command(cmdPublish).command(cmdPublishCanary).help().parse(hideBin(process.argv));

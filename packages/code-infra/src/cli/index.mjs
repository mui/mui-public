import * as fs from 'node:fs';
import * as path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';
import cmdArgosPush from './cmdArgosPush.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdBuild from './cmdBuild.mjs';

const pkgJson = /** @type {{version: string}} */ (
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'))
);

yargs()
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdListWorkspaces)
  .command(cmdJsonLint)
  .command(cmdArgosPush)
  .command(cmdCopyFiles)
  .command(cmdBuild)
  .demandCommand(1, 'You need at least one command before moving on')
  .version(pkgJson.version)
  .help()
  .parse(hideBin(process.argv));

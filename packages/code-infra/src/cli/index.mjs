import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdArgosPush from './cmdArgosPush.mjs';
import cmdBuild from './cmdBuild.mjs';
import cmdBuildRolldown from './cmdBuildRolldown.mjs';
import cmdBuildTsdown from './cmdBuildTsdown.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdJsonLint from './cmdJsonLint.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdSetVersionOverrides from './cmdSetVersionOverrides.mjs';

export default function start() {
  const version = createRequire(import.meta.url)(
    process.env.MUI_VERSION ? '../package.json' : '../../package.json',
  ).version;

  yargs()
    .scriptName('code-infra')
    .command(cmdPublish)
    .command(cmdPublishCanary)
    .command(cmdListWorkspaces)
    .command(cmdJsonLint)
    .command(cmdArgosPush)
    .command(cmdSetVersionOverrides)
    .command(cmdCopyFiles)
    .command(cmdBuild)
    .command(cmdBuildRolldown)
    .command(cmdBuildTsdown)
    .demandCommand(1, 'You need at least one command before moving on')
    .strict()
    .help()
    .version(version)
    .parse(hideBin(process.argv));
}

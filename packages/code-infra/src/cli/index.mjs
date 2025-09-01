import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdArgosPush from './cmdArgosPush.mjs';
import cmdBuild from './cmdBuild.mjs';
import cmdBuildNew from './cmdBuildNew.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdExtractErrorCodes from './cmdExtractErrorCodes.mjs';
import cmdGithubAuth from './cmdGithubAuth.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdPublishNewPackage from './cmdPublishNewPackage.mjs';
import cmdSetVersionOverrides from './cmdSetVersionOverrides.mjs';
import cmdValidateBuiltTypes from './cmdValidateBuiltTypes.mjs';

export function run() {
  const { version } = createRequire(import.meta.url)(
    process.env.MUI_VERSION ? '../package.json' : '../../package.json',
  );

  yargs()
    .scriptName('code-infra')
    .usage('$0 <command> [args]')
    .command(cmdArgosPush)
    .command(cmdBuild)
    .command(cmdBuildNew)
    .command(cmdCopyFiles)
    .command(cmdExtractErrorCodes)
    .command(cmdGithubAuth)
    .command(cmdListWorkspaces)
    .command(cmdPublish)
    .command(cmdPublishCanary)
    .command(cmdPublishNewPackage)
    .command(cmdSetVersionOverrides)
    .command(cmdValidateBuiltTypes)

    .demandCommand(1, 'You need at least one command before moving on')
    .strict()
    .help()
    .version(version)
    .parse(hideBin(process.argv));
}

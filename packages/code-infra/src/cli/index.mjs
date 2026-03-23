import chalk from 'chalk';
import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import cmdArgosPush from './cmdArgosPush.mjs';
import cmdBuild from './cmdBuild.mjs';
import cmdCopyFiles from './cmdCopyFiles.mjs';
import cmdExtractErrorCodes from './cmdExtractErrorCodes.mjs';
import cmdGenerateChangelog from './cmdGenerateChangelog.mjs';
import cmdGithubAuth from './cmdGithubAuth.mjs';
import cmdListWorkspaces from './cmdListWorkspaces.mjs';
import cmdNetlifyIgnore from './cmdNetlifyIgnore.mjs';
import cmdPublish from './cmdPublish.mjs';
import cmdPublishCanary from './cmdPublishCanary.mjs';
import cmdPublishNewPackage from './cmdPublishNewPackage.mjs';
import cmdSetVersionOverrides from './cmdSetVersionOverrides.mjs';
import cmdValidateBuiltTypes from './cmdValidateBuiltTypes.mjs';

const pkgJson = createRequire(import.meta.url)('../../package.json');

/** @type {{ verbose?: boolean }} */
let globalArgv = {};

await yargs(hideBin(process.argv))
  .scriptName('code-infra')
  .usage('$0 <command> [args]')
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Increase output verbosity',
    global: true,
  })
  .middleware((argv) => {
    globalArgv = argv;
  }, true)
  .command(cmdArgosPush)
  .command(cmdBuild)
  .command(cmdCopyFiles)
  .command(cmdExtractErrorCodes)
  .command(cmdGenerateChangelog)
  .command(cmdGithubAuth)
  .command(cmdListWorkspaces)
  .command(cmdNetlifyIgnore)
  .command(cmdPublish)
  .command(cmdPublishCanary)
  .command(cmdPublishNewPackage)
  .command(cmdSetVersionOverrides)
  .command(cmdValidateBuiltTypes)
  .fail((msg, err, yargsInstance) => {
    if (msg) {
      yargsInstance.showHelp();
      console.error(`\n${msg}`);
    } else if (err) {
      console.error(err.message);
      if (globalArgv.verbose) {
        console.error(chalk.dim(err.stack));
      }
    }
    process.exit(1);
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .strict()
  .help()
  .version(pkgJson.version)
  .parseAsync();

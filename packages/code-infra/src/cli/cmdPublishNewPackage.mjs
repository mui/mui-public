/* eslint-disable no-console */

import confirm from '@inquirer/confirm';
import chalk from 'chalk';
import { $ } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

import { getRepositoryInfo } from '../utils/git.mjs';
import { toPosixPath } from '../utils/path.mjs';
import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {boolean} [dryRun] If true, will only log the commands without executing them
 * @property {string} [otp] 6 digit auth code to forward to npm for two-factor authentication
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'publish-new-package [pkg...]',
  describe: 'Publish new empty package(s) to the npm registry.',
  builder: (yargs) =>
    yargs
      .option('dryRun', {
        type: 'boolean',
        default: false,
        description: 'If true, will only log the commands without executing them.',
      })
      .option('otp', {
        type: 'string',
        description: '6 digit auth code to forward to npm for two-factor authentication.',
        coerce: (value) => {
          if (value === undefined) {
            return value;
          }

          if (!/^\d{6}$/.test(value)) {
            throw new Error('The --otp option must be a 6 digit number.');
          }

          return value;
        },
      }),
  async handler(args) {
    console.log(`🔍 Detecting new packages to publish in workspace...`);
    const newPackages = await getWorkspacePackages({ nonPublishedOnly: true });

    if (!newPackages.length) {
      console.log('No new packages to publish.');
      return;
    }
    const cwd = process.cwd();

    console.log(`Found ${newPackages.map((pkg) => pkg.name).join(', ')} to publish.`);

    const answer = await confirm({
      message: `Do you want to publish ${newPackages.length} new package(s) to the npm registry?`,
    });

    if (!answer) {
      return;
    }

    const workspaceDir = await findWorkspaceDir(cwd);
    if (!workspaceDir) {
      throw new Error('This command should be run in a workspace.');
    }
    await Promise.all(
      newPackages.map(async (pkg) => {
        const newPkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-new-package-'));
        try {
          await fs.mkdir(newPkgDir, { recursive: true });
          const repo = await getRepositoryInfo();
          const packageJson = {
            name: pkg.name,
            version: '0.0.1',
            repository: {
              type: 'git',
              url: `git+https://github.com/${repo.owner}/${repo.repo}.git`,
              directory: toPosixPath(path.relative(workspaceDir, pkg.path)),
            },
          };
          await fs.writeFile(
            path.join(newPkgDir, 'package.json'),
            `${JSON.stringify(packageJson, null, 2)}\n`,
          );
          /**
           * @type {string[]}
           */
          const publishArgs = [];

          if (args.dryRun) {
            publishArgs.push('--dry-run');
          }
          if (args.otp) {
            publishArgs.push('--otp', args.otp);
          }
          await $({
            cwd: newPkgDir,
          })`npm publish --access public --tag=canary ${publishArgs}`;
          console.log(
            `✅ ${args.dryRun ? '[Dry run] ' : ''}Published ${chalk.bold(`${pkg.name}@${packageJson.version}`)} to npm registry.`,
          );
        } finally {
          await fs.rm(newPkgDir, { recursive: true, force: true });
        }
      }),
    );

    const trustedPublisherLinks = newPackages
      .map((pkg) => `https://www.npmjs.com/package/${pkg.name}/access`)
      .join('\n');
    console.log(`
📝 Please ensure that the ${chalk.underline(chalk.bold('Trusted Publishers'))} settings are configured for the new package(s):
${trustedPublisherLinks}
Read how to do that here - https://github.com/mui/mui-public/blob/master/packages/code-infra/README.md#adding-and-publishing-new-packages`);
  },
});

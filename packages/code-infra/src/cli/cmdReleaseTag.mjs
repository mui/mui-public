/* eslint-disable no-console */
import { $ } from 'execa';
import gitUrlParse from 'git-url-parse';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {Object} Args
 * @property {boolean} dry-run Run in dry-run mode without publishing
 * @property {string} repo Repository to tag
 * @property {string} owner Repository owner/org
 */

/**
 * Find the remote pointing to mui/{repo}.
 *
 * Conventionally this should be named `upstream` but some collaborators might've used a different naming scheme.
 *
 * @param {string} repo
 * @param {string} owner
 */
async function findMuiOrgRemote(repo, owner = 'mui') {
  const { stdout } = await $`git remote -v`;
  const remoteLines = stdout.trim().split(/\r?\n/);

  return remoteLines
    .map((remoteLine) => {
      const [name, url, method] = remoteLine.split(/\s/);
      return { name, url, method };
    })
    .find((remote) => {
      const parsed = gitUrlParse(remote.url);
      return parsed.owner === owner && parsed.name === repo;
    });
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'release-tag',
  describe: 'Tags the current release and pushes these changes to git remote.',
  builder: (yargs) => {
    return yargs
      .option('dry-run', {
        default: false,
        describe: 'If true, the script will not have any permanent side-effects.',
        type: 'boolean',
      })
      .option('repo', {
        demandOption: 'Provide a repository to tag',
        describe: 'Repository to tag',
        type: 'string',
      });
  },
  handler: async (argv) => {
    const { 'dry-run': dryRun, repo } = argv;
    const cwd = process.cwd();
    const rootWorkspaceManifest = JSON.parse(
      await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'),
    );

    const tag = `v${rootWorkspaceManifest.version}`;
    const message = `Version ${rootWorkspaceManifest.version}`;

    if (!dryRun) {
      await $`git tag -a ${tag} -m "${message}"`;
    } else {
      console.log(`🚜 [dry-run] git tag -a ${tag} -m "${message}"`);
    }
    console.log(`✅ Created tag '${tag}'. To remove enter 'git tag -d ${tag}'`);

    const repoOwner = 'mui';
    const muiOrgRemote = await findMuiOrgRemote(repo, repoOwner);
    if (muiOrgRemote === undefined) {
      throw new TypeError(
        `❌ Unable to find the upstream remote. It should be a remote pointing to "${repoOwner}/${repo}".
Did you forget to add it via \`git remote add upstream git@github.com:${repoOwner}/${repo}.git\`?
If you think this is a bug please include \`git remote -v\` in your report.`,
      );
    }

    if (!dryRun) {
      await $`git push ${muiOrgRemote.name} ${tag}`;
    } else {
      console.log(`🚜 [dry-run] git push ${muiOrgRemote.name} ${tag}`);
    }

    console.log(
      `✅ Pushed tag '${tag}' to ${muiOrgRemote.name}. This should not be reversed. In case of emergency, run "git push --delete ${muiOrgRemote.name} ${tag}" to remove.`,
    );
  },
});

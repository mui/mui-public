import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepositoryInfo } from '../utils/git.mjs';

/**
 * @typedef {Object} Args
 * @property {string} config Path to the changelog configuration file
 * @property {string} lastRelease The git reference (tag/commit) of the last release
 * @property {string} release The git reference (tag/commit) of the new release
 * @property {string} releaseVersion The version number for the new release
 * @property {string} cwd The current working directory to run the command in
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'generate-changelog',
  describe: 'Generate changelog for the project',
  builder: (yargs) => {
    return yargs
      .option('config', {
        type: 'string',
        default: 'scripts/changelog.config.mjs',
        description: 'Path to the changelog configuration file.',
      })
      .option('lastRelease', {
        type: 'string',
        description: 'The git reference (tag/commit) of the last release.',
      })
      .option('release', {
        type: 'string',
        description: 'The git reference (tag/commit) of the new release.',
      })
      .option('releaseVersion', {
        type: 'string',
        description: 'The version number for the new release.',
      })
      .option('cwd', {
        type: 'string',
        description: 'Current working directory to run the command in.',
        default: process.cwd(),
      });
  },
  handler: async (args) => {
    const { generateChangelog, findLatestTaggedVersion, loadChangelogConfig } =
      await import('../changelog/index.mjs');
    const cwd = args.cwd;
    const version =
      args.releaseVersion ??
      JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')).version;
    const repoInfo = await getRepositoryInfo(cwd);
    const lastTag =
      args.lastRelease ??
      (await findLatestTaggedVersion({
        cwd,
      }));
    const config = await loadChangelogConfig(path.resolve(args.config), cwd);
    const changelog = await generateChangelog({
      config,
      lastRelease: lastTag,
      release: args.release ?? 'HEAD',
      org: repoInfo.owner,
      repo: repoInfo.repo,
      version,
      date: new Date(),
      cwd,
    });
    // eslint-disable-next-line no-console
    console.log(changelog.markdown);
  },
});

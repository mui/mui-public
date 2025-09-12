/**
 * @typedef {import('../utils/changelog.mjs').Args} Args
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'generate-changelog',
  describe: 'Generates changelog from Github commit history.',
  builder(yargs) {
    return yargs
      .option('repo', {
        type: 'string',
        describe: 'The github repo to generate changelog for.',
        demandOption: true,
      })
      .option('lastRelease', {
        describe:
          'The release to compare against e.g. `v1.0.0-alpha.4`. Default: The latest tag on the current branch.',
        type: 'string',
      })
      .option('githubToken', {
        default: process.env.GITHUB_TOKEN,
        describe:
          'The personal access token to use for authenticating with GitHub. Needs public_repo permissions.',
        type: 'string',
      })
      .option('release', {
        // #default-branch-switch
        default: 'master',
        describe: 'Ref which we want to release',
        type: 'string',
      })
      .option('format', {
        default: 'changelog',
        describe: 'Format of the generated text. Either "changelog" or "docs"',
        type: 'string',
        choices: ['changelog', 'docs'],
      })
      .option('api', {
        default: 'rest',
        describe: 'The GitHub API to use. Either "rest" or "graphql"',
        type: 'string',
        choices: ['rest', 'graphql'],
      })
      .option('repoPath', {
        type: 'string',
        describe: 'The path to the git repo to generate the changelog for. Only used for testing.',
        default: process.cwd(),
      });
  },
  async handler(args) {
    const module = await import('../utils/changelog.mjs');
    const changelog = await module.default(args);
    // eslint-disable-next-line no-console
    console.log(changelog);
  },
});

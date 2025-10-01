/* eslint-disable no-console */

/**
 * @typedef {Object} Args
 * @property {boolean} authorize
 * @property {boolean} clear
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'github',
  describe: 'Authenticates the user with GitHub and stores the access token securely.',
  builder: (yargs) =>
    yargs
      .option('authorize', {
        type: 'boolean',
        describe: 'Trigger the authentication flow to get a new token if not found.',
        default: false,
      })
      .option('clear', {
        type: 'boolean',
        describe: 'Clear stored GitHub authentication tokens.',
        default: false,
      }),
  async handler(args) {
    const gh = await import('../utils/github.mjs');
    if (args.clear) {
      await gh.clearGitHubAuth();
      console.log('✅ GitHub auth tokens cleared.');
      return;
    }
    if (args.authorize) {
      await gh.endToEndGhAuthGetToken(true);
      console.log('✅ GitHub auth tokens successfully retrieved.');
    }
  },
});

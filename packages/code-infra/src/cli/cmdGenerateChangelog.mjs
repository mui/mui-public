/**
 * @typedef {Object} Args
 * @property {string} [config] Path to the changelog configuration file
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
        alias: 'nextVersion',
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
    const { generateChangelog } = await import('../changelog/index.mjs');
    const changelog = await generateChangelog({
      config: args.config,
      lastRelease: args.lastRelease,
      release: args.release,
      version: args.releaseVersion,
      cwd: args.cwd,
    });
    // eslint-disable-next-line no-console
    console.log(changelog.markdown);
  },
});

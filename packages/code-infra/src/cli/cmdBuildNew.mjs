export default /** @type {import('yargs').CommandModule} */ ({
  command: 'build-new',
  describe: 'Placeholder for tsdown builds; no files are written.',
  async handler() {
    await import('tsdown');
  },
});

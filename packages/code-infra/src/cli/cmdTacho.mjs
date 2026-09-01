#!/usr/bin/env node

/**
 * @typedef {Object} Args
 * @property {string[]} [filters] - Only run cases whose folder name contains one of these substrings
 * @property {string} [baseline] - Binds the `baseline` symbol, in the ref grammar
 * @property {string} [baseBranch] - Branch PRs fork from
 * @property {string} [buildCmd] - Command that builds the publishable packages
 * @property {boolean} [install] - Whether to install inside a ref's checkout
 * @property {string} [out] - Where to write the combined JSON report
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'tacho run [filters...]',
  describe:
    'Benchmark a tachometer harness across builds of this workspace and write a JSON report. Run from the harness package.',
  builder: (yargs) => {
    return yargs
      .positional('filters', {
        type: 'string',
        array: true,
        describe: 'Only run cases whose folder name contains this substring',
      })
      .option('baseline', {
        type: 'string',
        describe:
          'Bind the "baseline" symbol, in the ref grammar (e.g. git:abc1234). Default: on the base branch HEAD~1, otherwise the fork point from the base branch',
      })
      .option('base-branch', {
        type: 'string',
        describe:
          'Branch PRs fork from. Default: detected from origin/HEAD, falling back to master',
      })
      .option('build-cmd', {
        type: 'string',
        default: 'pnpm release:build',
        describe: 'Command that builds the publishable workspace packages',
      })
      .option('install', {
        type: 'boolean',
        default: true,
        describe: "Install dependencies inside a ref's checkout. Use --no-install to skip",
      })
      .option('out', {
        type: 'string',
        describe: 'Write the combined JSON report here. Default: results/report.json',
      })
      .epilogue(
        'Sampling (sampleSize, autoSampleConditions, timeout) is configured per case in its own tachometer.json — tachometer rejects those as CLI flags when a config file is used.',
      );
  },
  handler: async (argv) => {
    const { runTachometer } = await import('../tachometer/runTachometer.mjs');
    await runTachometer({
      harnessDir: process.cwd(),
      filters: argv.filters ?? [],
      baseline: argv.baseline,
      baseBranch: argv.baseBranch,
      buildCmd: argv.buildCmd,
      install: argv.install,
      out: argv.out,
    });
  },
});

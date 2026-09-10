import type { CommandModule } from 'yargs';
import type { RunTachometerOptions } from '../tachometer/runTachometer';

/** Everything `runTachometer` takes except the directory, which is where the command was run. */
type Args = Omit<RunTachometerOptions, 'harnessDir'>;

const command: CommandModule<{}, Args> = {
  command: 'run [filters...]',
  describe:
    'Benchmark a tachometer harness across builds of this workspace and write a JSON report. Run from the harness package.',
  builder: (yargs) => {
    return yargs
      .positional('filters', {
        type: 'string',
        array: true,
        describe: 'Only run cases whose path under src contains this substring',
      })
      .option('baseline', {
        type: 'string',
        describe:
          'Bind the "baseline" symbol, in the ref grammar (e.g. git:abc1234). Defaults to HEAD~1; `code-infra baseline` resolves a fork point to pass here',
      })
      .option('build-cmd', {
        type: 'string',
        default: 'pnpm release:build',
        describe:
          "Command that builds the publishable workspace packages, in each ref's checkout and in the working tree",
      })
      .option('install', {
        type: 'boolean',
        default: true,
        describe: "Install dependencies inside a ref's checkout. Use --no-install to skip",
      })
      .option('upload', {
        type: 'boolean',
        default: process.env.TACHO_UPLOAD === 'true',
        describe:
          'Upload the report and refresh the PR comment. Defaults to TACHO_UPLOAD=true, so CI can switch it on by environment. Requires CIRCLE_OIDC_TOKEN_V2',
      })
      .option('out', {
        type: 'string',
        describe: 'Write the combined JSON report here. Default: .tachometer/results/report.json',
      })
      .epilogue(
        'Sampling (sampleSize, autoSampleConditions, timeout) is configured per case in its own tachometer.json — tachometer rejects those as CLI flags when a config file is used.',
      );
  },
  handler: async (argv) => {
    const { runTachometer } = await import('../tachometer/runTachometer');
    await runTachometer({
      harnessDir: process.cwd(),
      filters: argv.filters ?? [],
      baseline: argv.baseline,
      buildCmd: argv.buildCmd,
      install: argv.install,
      out: argv.out,
      upload: argv.upload,
    });
  },
};

export default command;

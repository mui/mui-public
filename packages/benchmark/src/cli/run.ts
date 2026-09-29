import type { CommandModule } from 'yargs';
import type { RunBenchmarksOptions } from '../runner/runBenchmarks';

/** Everything `runBenchmarks` takes except the directory, which is where the command was run. */
type Args = Omit<RunBenchmarksOptions, 'harnessDir'>;

const command: CommandModule<{}, Args> = {
  command: 'run [filters...]',
  describe:
    "Benchmark a harness's *.bench.tsx files, the working tree against a baseline build, and write a JSON report. Run from the harness package.",
  builder: (yargs) => {
    return yargs
      .positional('filters', {
        type: 'string',
        array: true,
        describe: 'Only run benchmark files whose path under src contains this substring',
      })
      .option('baseline', {
        type: 'string',
        describe:
          'The build to compare against: a revision, on its own or as git:<rev>. Defaults to HEAD~1, the parent commit; `code-infra baseline` resolves a fork point to pass here',
      })
      .option('build-cmd', {
        type: 'string',
        describe:
          "Command that builds the publishable workspace packages, in each ref's checkout and in the working tree. Default: pnpm release:build",
      })
      .option('upload', {
        type: 'boolean',
        default: process.env.BENCHMARK_UPLOAD === 'true',
        describe:
          'Upload the report and refresh the PR comment. Defaults to BENCHMARK_UPLOAD=true, so CI can switch it on by environment. Requires CIRCLE_OIDC_TOKEN_V2',
      })
      .option('out', {
        type: 'string',
        describe: 'Write the JSON report here. Default: .benchmark/results/report.json',
      });
  },
  handler: async (argv) => {
    const { runBenchmarks } = await import('../runner/runBenchmarks');
    await runBenchmarks({
      harnessDir: process.cwd(),
      filters: argv.filters ?? [],
      baseline: argv.baseline,
      buildCmd: argv.buildCmd,
      out: argv.out,
      upload: argv.upload,
    });
  },
};

export default command;

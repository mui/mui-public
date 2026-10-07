#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';
import type { CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';

// Self-referencing rather than `../../package.json`: this file is one directory deeper in the
// repository than in the published package, which is built from `build/`, so a relative path
// cannot reach the manifest from both — and the repository's workspace symlink hides the break.
import pkgJson from '@mui/internal-benchmark/package.json' with { type: 'json' };
import type { RunBenchmarksOptions } from '../runner/runBenchmarks';

/**
 * Everything `runBenchmarks` takes except the directory, which is where the command was run, with
 * its sampling overrides as flags of their own.
 */
type Args = Omit<RunBenchmarksOptions, 'harnessDir' | 'sampling'> & {
  sampleSize?: number;
  timeout?: number;
  autoSampleConditions?: string[];
};

const runCommand: CommandModule<{}, Args> = {
  command: '$0 [filters...]',
  describe:
    "Benchmark a harness's *.bench.tsx files, the working tree against a baseline build, and write a JSON report. Run from the harness package.",
  builder: (args) =>
    args
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
      })
      .option('testNamePattern', {
        alias: 't',
        type: 'string',
        describe: 'Only run benchmarks whose name matches this regular expression',
      })
      .option('reporter', {
        choices: ['default', 'json'] as const,
        default: 'default' as const,
        describe:
          'How to print the results: tables, or the analysis as JSON on stdout (medians, intervals, verdicts), with everything else on stderr',
      })
      .option('profile', {
        type: 'boolean',
        default: false,
        describe:
          'Record instead of measuring: a performance trace around every sample, saved to open in DevTools. Writes no report',
      })
      .option('sample-size', {
        type: 'number',
        describe:
          "Rounds before deciding whether to continue, overriding every benchmark's own; with --profile, the rounds to record (default 5)",
      })
      .option('timeout', {
        type: 'number',
        describe: "Minutes to keep sampling while unresolved, overriding every benchmark's own",
      })
      .option('auto-sample-conditions', {
        type: 'string',
        array: true,
        describe: "Horizons to resolve, such as 5% or 10%, overriding every benchmark's own",
      }),
  handler: async (argv) => {
    if (argv.reporter === 'json') {
      // Stdout carries the JSON alone; what a run prints along the way is progress.
      /* eslint-disable no-console */
      console.log = console.error;
      console.info = console.error;
      /* eslint-enable no-console */
    }
    const { runBenchmarks } = await import('../runner/runBenchmarks');
    await runBenchmarks({
      harnessDir: process.cwd(),
      filters: argv.filters ?? [],
      baseline: argv.baseline,
      buildCmd: argv.buildCmd,
      out: argv.out,
      upload: argv.upload,
      testNamePattern: argv.testNamePattern,
      reporter: argv.reporter,
      profile: argv.profile,
      sampling: {
        sampleSize: argv.sampleSize,
        timeout: argv.timeout,
        autoSampleConditions: argv.autoSampleConditions,
      },
    });
  },
};

// chalk honours FORCE_COLOR and --no-color, not the NO_COLOR convention (https://no-color.org):
// set to anything but an empty string, it turns colour off.
if (process.env.NO_COLOR) {
  chalk.level = 0;
}

let globalArgv: { verbose?: boolean } = {};

await yargs(hideBin(process.argv))
  .scriptName('benchmark')
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Increase output verbosity',
    global: true,
  })
  .middleware((argv) => {
    globalArgv = argv;
  }, true)
  .command(runCommand)
  .fail((msg, err, yargsInstance) => {
    if (msg) {
      yargsInstance.showHelp();
      console.error(`\n${msg}`);
    } else if (err) {
      console.error(err.message);
      if (globalArgv.verbose) {
        console.error(chalk.dim(err.stack));
      }
    }
    process.exit(1);
  })
  .strict()
  .help()
  .version(pkgJson.version)
  .parseAsync();

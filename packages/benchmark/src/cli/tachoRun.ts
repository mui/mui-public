import type { CommandModule } from 'yargs';

interface Args {
  /**
   * Only run cases whose path under `src` contains one of these substrings, case-insensitively.
   */
  filters?: string[];
  /** Binds the `baseline` symbol, in the ref grammar. */
  baseline?: string;
  /** Branch PRs fork from. */
  baseBranch?: string;
  /** Command that builds the publishable packages of a checked-out ref. */
  buildCmd?: string;
  /** Command that builds the working tree. */
  workingTreeBuildCmd?: string;
  /** Whether to install inside a ref's checkout. */
  install?: boolean;
  /** Where to write the combined JSON report. */
  out?: string;
  /** Upload the report and refresh the pull request comment. */
  upload?: boolean;
}

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
        describe: "Command that builds the publishable workspace packages of a ref's checkout",
      })
      .option('working-tree-build-cmd', {
        type: 'string',
        describe:
          'Command that builds the working tree. Defaults to --build-cmd; point it at a cached build when the two differ only in caching',
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
      ) as any;
  },
  handler: async (argv) => {
    const { runTachometer } = await import('../tachometer/runTachometer');
    await runTachometer({
      harnessDir: process.cwd(),
      filters: argv.filters ?? [],
      baseline: argv.baseline,
      baseBranch: argv.baseBranch,
      buildCmd: argv.buildCmd,
      workingTreeBuildCmd: argv.workingTreeBuildCmd,
      install: argv.install,
      out: argv.out,
      upload: argv.upload,
    });
  },
};

export default command;

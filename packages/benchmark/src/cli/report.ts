import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { CommandModule } from 'yargs';
import { OUTPUT_DIR } from '../runner/outputDir';

interface Args {
  /** Path to a JSON report written by `benchmark run`. */
  file: string;
}

const DEFAULT_REPORT = path.join(OUTPUT_DIR, 'results', 'report.json');

const command: CommandModule<{}, Args> = {
  command: 'report [file]',
  describe:
    'Print the tables for a JSON report written by `benchmark run`. Reads the last run of the harness in the current directory when no path is given.',
  builder: (yargs) => {
    return yargs.positional('file', {
      type: 'string',
      default: DEFAULT_REPORT,
      describe: 'Path to the JSON report',
    });
  },
  handler: async (argv) => {
    const reportPath = path.resolve(argv.file);
    const raw = await readFile(reportPath, 'utf8').catch(() => {
      throw new Error(
        `No report at ${reportPath}. Pass a path, or run \`benchmark run\` from a harness first.`,
      );
    });

    const { benchmarkRunReportSchema } = await import('../runReport');
    const parsed = benchmarkRunReportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${reportPath} is not a benchmark report this version can read.\n` +
          `${z.prettifyError(parsed.error)}`,
      );
    }

    const { printRunReport } = await import('../runner/printReport');
    printRunReport(parsed.data);
  },
};

export default command;

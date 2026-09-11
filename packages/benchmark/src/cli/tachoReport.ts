import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { CommandModule } from 'yargs';
import { OUTPUT_DIR } from '../tachometer/outputDir';

interface Args {
  /** Path to a JSON report written by `tacho run`. */
  file: string;
}

const DEFAULT_REPORT = path.join(OUTPUT_DIR, 'results', 'report.json');

const command: CommandModule<{}, Args> = {
  command: 'report [file]',
  describe:
    'Print the table for a JSON report written by `tacho run`. Reads the last run of the harness in the current directory when no path is given.',
  builder: (yargs) => {
    return yargs
      .positional('file', {
        type: 'string',
        default: DEFAULT_REPORT,
        describe: 'Path to the JSON report',
      })
      .epilogue(
        'The same table `tacho run` prints when it finishes, so a report kept from an earlier run — or downloaded from CI — can be read without sampling again.',
      );
  },
  handler: async (argv) => {
    const reportPath = path.resolve(argv.file);
    const raw = await readFile(reportPath, 'utf8').catch(() => {
      throw new Error(
        `No report at ${reportPath}. Pass a path, or run \`tacho run\` from a harness first.`,
      );
    });

    const { tachometerReportSchema } = await import('../tachometer/ciReport');
    const parsed = tachometerReportSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${reportPath} is not a tachometer report this version can read.\n` +
          `${z.prettifyError(parsed.error)}`,
      );
    }

    const { renderTachometerReport } = await import('../tachometer/renderReport');
    renderTachometerReport(parsed.data);
  },
};

export default command;

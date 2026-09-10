import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
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
    return (
      yargs
        // Not named `report`: yargs binds a positional whose name repeats its own subcommand word to
        // the literal token, so `tacho report` would resolve the path "report".
        .positional('file', {
          type: 'string',
          default: DEFAULT_REPORT,
          describe: 'Path to the JSON report',
        })
        .epilogue(
          'The same table `tacho run` prints when it finishes, so a report kept from an earlier run — or downloaded from CI — can be read without sampling again.',
        )
    );
  },
  handler: async (argv) => {
    const reportPath = path.resolve(argv.file);
    const raw = await readFile(reportPath, 'utf8').catch(() => {
      throw new Error(
        `No report at ${reportPath}. Pass a path, or run \`tacho run\` from a harness first.`,
      );
    });

    const report = JSON.parse(raw);
    // The report a run writes and the artifact the dashboard stores are the same shape, so this
    // reads either. The check is for the other benchmark axis, whose reports carry different
    // statistics that rendering here would silently read as confidence intervals on a difference.
    if (report?.reportType !== 'tachometer') {
      throw new Error(
        `${reportPath} is not a tachometer report (its "reportType" is ${JSON.stringify(report?.reportType)}).`,
      );
    }

    const { renderTachometerReport } = await import('../tachometer/renderReport');
    renderTachometerReport(report);
  },
};

export default command;

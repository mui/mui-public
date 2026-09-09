import type { CommandModule } from 'yargs';
import tachoReport from './tachoReport';
import tachoRun from './tachoRun';

/**
 * The `tacho` command group.
 *
 * Its subcommands are registered here rather than as separate top-level commands: yargs keys a
 * command on its first word, so `tacho run …` and `tacho report …` registered side by side would
 * both claim `tacho` and the later one would answer for both.
 */
const command: CommandModule<{}, {}> = {
  command: 'tacho <command>',
  describe: 'Benchmark a tachometer harness, and read the reports it writes.',
  builder: (yargs) =>
    yargs.command(tachoRun).command(tachoReport).demandCommand(1, 'Specify a tacho subcommand.'),
  handler: () => {},
};

export default command;

import type { CommandModule } from 'yargs';
import tachoReport from './tachoReport';
import tachoRun from './tachoRun';

/**
 * The `tacho` command group.
 */
const command: CommandModule<{}, {}> = {
  command: 'tacho <command>',
  describe: 'Benchmark a tachometer harness, and read the reports it writes.',
  builder: (yargs) =>
    yargs.command(tachoRun).command(tachoReport).demandCommand(1, 'Specify a tacho subcommand.'),
  handler: () => {},
};

export default command;

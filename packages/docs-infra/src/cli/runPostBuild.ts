/* eslint-disable no-console */
import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { generateMarkdownAlternates } from '../markdownAlternates/markdownAlternates';

type Args = {
  dir: string;
};

const completeMessage = (message: string) => `✓ ${chalk.green(message)}`;

const runPostBuild: CommandModule<{}, Args> = {
  command: 'post-build',
  describe: 'Post-process build output',
  builder: (yargs) => {
    return yargs.option('dir', {
      type: 'string',
      description: 'The output directory of Next.js',
      default: 'out',
    });
  },
  handler: async (args) => {
    const cwd = process.cwd();

    await Promise.all([
      (async () => {
        console.log(chalk.cyan('Generating markdown alternatives...'));

        const startMark = 'generateMarkdownAlternates: start';
        performance.mark(startMark);

        const { knownPagesCount } = await generateMarkdownAlternates(cwd, args.dir);

        const endMark = 'generateMarkdownAlternates: end';
        performance.mark(endMark);
        const measure = performance.measure(
          'generateMarkdownAlternates: generate',
          startMark,
          endMark,
        );

        console.log(
          completeMessage(
            `${knownPagesCount} markdown alternatives generated in ${(measure.duration / 1000).toPrecision(3)}s`,
          ),
        );
      })(),
    ]);
  },
};

export default runPostBuild;

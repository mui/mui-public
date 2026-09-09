/* eslint-disable no-console */

import chalk from 'chalk';
import { execa } from 'execa';

/**
 * Runs a command in `cwd` with inherited stdio, throwing on a non-zero exit.
 *
 * Echoes the command first: a benchmark run shells out a lot, and being able to copy a failing step
 * out of the log and re-run it by hand is worth the noise.
 */
export async function run(
  file: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  console.log(chalk.dim(`$ ${file} ${args.join(' ')}  (in ${cwd})`));
  await execa(file, args, { cwd, stdio: 'inherit', env });
}

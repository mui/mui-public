/* eslint-disable no-console */

import chalk from 'chalk';
import { execa } from 'execa';

export interface RunOptions {
  /** Extends the current environment rather than replacing it. */
  env?: NodeJS.ProcessEnv;
  /**
   * Let the command's output through, for one whose progress is worth watching — a build, a sampling
   * run.
   *
   * Otherwise it is captured, so a successful run says nothing. Nothing is lost either way: execa
   * puts both streams on the error it throws, so a failure reports everything it printed.
   */
  verbose?: boolean;
}

/**
 * Runs a command in `cwd`, throwing on a non-zero exit.
 *
 * Echoes the command first: a benchmark run shells out a lot, and being able to copy a failing step
 * out of the log and re-run it by hand is worth the noise.
 */
export async function run(
  file: string,
  args: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<void> {
  const { env, verbose = false } = options;
  console.log(chalk.dim(`$ ${file} ${args.join(' ')}  (in ${cwd})`));
  await execa(file, args, { cwd, env, stdio: verbose ? 'inherit' : 'pipe' });
}

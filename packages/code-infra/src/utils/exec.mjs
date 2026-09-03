/* eslint-disable no-console */

import chalk from 'chalk';
import { execa } from 'execa';

/**
 * Runs a command in `cwd` with inherited stdio, throwing on a non-zero exit.
 *
 * Echoes the command first: a benchmark run shells out a lot, and being able to copy a failing step
 * out of the log and re-run it by hand is worth the noise.
 *
 * @param {string} file - Executable to run
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory
 * @param {NodeJS.ProcessEnv} [env] - Extends the current environment
 * @returns {Promise<void>}
 */
export async function run(file, args, cwd, env) {
  console.log(chalk.dim(`$ ${file} ${args.join(' ')}  (in ${cwd})`));
  await execa(file, args, { cwd, stdio: 'inherit', env });
}

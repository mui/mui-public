// Starts a command and dies on a signal without passing it on, orphaning the
// command, like `pnpm run` does when it's attached to a terminal.
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

spawn(command, args, { stdio: 'inherit' });

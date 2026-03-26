/* eslint-disable no-console */
import type { CommandModule } from 'yargs';
import { $, which } from 'zx';
import { existsSync } from 'node:fs';

const CONTAINER_NAME = 'docs-infra-playwright';

type Args = {
  port: number;
  script: string;
  'playwright-version': string;
  _: (string | number)[];
  '--'?: string[];
};

/**
 * Resolves the container engine command.
 * Inside a toolbx/distrobox container, use `flatpak-spawn` to reach the host.
 */
function resolveEngine(): string[] {
  if (process.env.CONTAINER_ENGINE) {
    return process.env.CONTAINER_ENGINE.split(/\s+/);
  }

  if (which.sync('podman', { nothrow: true })) {
    return ['podman'];
  }

  if (which.sync('docker', { nothrow: true })) {
    return ['docker'];
  }

  // Inside a toolbx/distrobox container
  if (existsSync('/run/.containerenv') && which.sync('flatpak-spawn', { nothrow: true })) {
    return ['flatpak-spawn', '--host', 'podman'];
  }

  throw new Error(
    'A container engine (podman or docker) is required but not found.\n' +
      'Install podman or docker, or set CONTAINER_ENGINE.',
  );
}

async function engine(...args: string[]) {
  const cmd = resolveEngine();
  return $`${cmd} ${args}`;
}

async function engineQuiet(...args: string[]) {
  const cmd = resolveEngine();
  return $({ nothrow: true })`${cmd} ${args}`.quiet();
}

async function stopContainer() {
  console.log('Stopping Playwright server…');
  await engineQuiet('stop', CONTAINER_NAME);
}

async function waitForServer(port: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fetch(`http://localhost:${port}/`);
      return true;
    } catch {
      if (i === maxAttempts) {
        return false;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }
  return false;
}

async function handler(argv: Args) {
  const port = argv.port;

  // Always clean up on exit.
  process.once('SIGINT', async () => {
    await stopContainer();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await stopContainer();
    process.exit(143);
  });

  try {
    // Remove stale container if present.
    await engineQuiet('rm', '-f', CONTAINER_NAME);

    const image = `mcr.microsoft.com/playwright:v${argv['playwright-version']}-noble`;

    console.log(`Starting Playwright server on port ${port}…`);
    await engine(
      'run',
      '--rm',
      '-d',
      '--name',
      CONTAINER_NAME,
      '--network=host',
      '--shm-size=1g',
      image,
      'npx',
      '--yes',
      'playwright',
      'run-server',
      '--port',
      String(port),
      '--host',
      '0.0.0.0',
    );

    // Wait for the server to be ready.
    const ready = await waitForServer(port);

    if (!ready) {
      const logs = await engineQuiet('logs', CONTAINER_NAME);
      console.error('Playwright server failed to start. Container logs:');
      console.error(logs.stdout);
      process.exitCode = 1;
      return;
    }

    // Run Vitest against the remote Playwright server.
    console.log('Running browser tests…');
    // Forward positional args and anything after "--" to the test command.
    const positional = argv._.slice(1).map(String);
    const passthrough = argv['--'] ?? [];
    const extra = [...positional, ...passthrough];
    const env = { ...process.env, PLAYWRIGHT_SERVER: `ws://localhost:${port}` };
    await $({ env, stdio: 'inherit' })`pnpm -w run ${argv.script} ${extra}`;
  } finally {
    await stopContainer();
  }
}

const runBrowser: CommandModule<{}, Args> = {
  command: 'browser [args..]',
  describe: 'Runs browser tests using a containerized Playwright server',
  builder: (yargs) => {
    return yargs
      .option('port', {
        type: 'number',
        description: 'Port for the Playwright WebSocket server',
        default: 3333,
      })
      .option('script', {
        type: 'string',
        description: 'Root package.json script to run',
        demandOption: true,
      })
      .option('playwright-version', {
        type: 'string',
        description: 'Playwright version for the container image',
        demandOption: true,
      })
      .parserConfiguration({ 'populate--': true })
      .strict(false);
  },
  handler,
};

export default runBrowser;

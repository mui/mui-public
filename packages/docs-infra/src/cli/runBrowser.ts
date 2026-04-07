/* eslint-disable no-console */
import type { CommandModule } from 'yargs';
import { $, which } from 'zx';
import { existsSync } from 'node:fs';

const CONTAINER_NAME = 'docs-infra-playwright';

type Args = {
  port: number;
  script: string;
  'playwright-version': string;
  headed: boolean;
  workspace: boolean;
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
  // --headed may arrive as a yargs option or inside the passthrough args
  // (pnpm run inserts -- before forwarding extra args).
  const headed = argv.headed || (argv['--'] ?? []).includes('--headed');

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

    // Pull the image first so progress is visible to the user.
    const cmd = resolveEngine();
    await $({ stdio: 'inherit' })`${cmd} pull ${image}`;

    const containerArgs = [
      'run',
      '--rm',
      '-d',
      '--name',
      CONTAINER_NAME,
      '--network=host',
      '--shm-size=1g',
    ];

    // Forward the host X11 display so headed browsers can render.
    if (headed) {
      const display = process.env.DISPLAY;
      if (!display) {
        console.error('--headed requires a display server but $DISPLAY is not set.');
        process.exitCode = 1;
        return;
      }
      containerArgs.push(
        '-e',
        `DISPLAY=${display}`,
        '-v',
        '/tmp/.X11-unix:/tmp/.X11-unix',
        // Disable SELinux labels so the container can access the X11 socket.
        '--security-opt',
        'label=disable',
      );
      // Forward X11 auth so the container can authenticate with the X server.
      const xauthority = process.env.XAUTHORITY || `${process.env.HOME}/.Xauthority`;
      containerArgs.push(
        '-e',
        'XAUTHORITY=/tmp/.Xauthority',
        '-v',
        `${xauthority}:/tmp/.Xauthority:ro`,
      );
    }

    containerArgs.push(
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

    console.log(`Starting Playwright server on port ${port}…`);
    await engine(...containerArgs);

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
    // --headed is consumed here (not forwarded) since vitest doesn't know it.
    const positional = argv._.slice(1).map(String);
    const passthrough = argv['--'] ?? [];
    const extra = [...positional, ...passthrough.filter((a) => a !== '--headed')];
    if (headed) {
      extra.push('--browser.headless=false');
    }
    const env = { ...process.env, PLAYWRIGHT_SERVER: `ws://localhost:${port}` };
    const pnpmArgs = argv.workspace ? ['-w'] : [];
    await $({ env, stdio: 'inherit' })`pnpm ${pnpmArgs} run ${argv.script} ${extra}`;
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
      .option('headed', {
        type: 'boolean',
        description: 'Run browsers in headed mode (requires X11)',
        default: false,
      })
      .option('workspace', {
        alias: 'w',
        type: 'boolean',
        description: 'Run the script from the workspace root (passes -w to pnpm)',
        default: false,
      })
      .parserConfiguration({ 'populate--': true })
      .strict(false);
  },
  handler,
};

export default runBrowser;

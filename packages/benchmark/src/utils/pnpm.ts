import * as path from 'node:path';
import { access, constants, mkdir, writeFile } from 'node:fs/promises';
import { $ } from 'execa';

async function isOnPath(command: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const found = await Promise.allSettled(
    dirs.map((dir) => access(path.join(dir, command), constants.X_OK)),
  );
  return found.some((result) => result.status === 'fulfilled');
}

/**
 * What a `pnpm` shim forwards to: corepack when it is there, which runs the version each checkout's
 * `packageManager` pins — a baseline may pin another than the working tree — or else the pnpm that
 * launched this process, from the `npm_execpath` pnpm sets for what it runs.
 */
async function pnpmTarget(): Promise<string | null> {
  if (await isOnPath('corepack')) {
    return 'corepack pnpm';
  }
  const execPath = process.env.npm_execpath;
  if (!execPath || !path.basename(execPath).startsWith('pnpm')) {
    return null;
  }
  return /\.[cm]?js$/.test(execPath) ? `"${process.execPath}" "${execPath}"` : `"${execPath}"`;
}

/**
 * Puts `pnpm` on `PATH` when it isn't there — when it comes through corepack without its shims,
 * say — so the commands a run shells out to, and the scripts those run in turn, all find it.
 * POSIX only: Windows resolves commands differently.
 */
export async function ensurePnpmOnPath(binDir: string): Promise<void> {
  if (process.platform === 'win32' || (await isOnPath('pnpm'))) {
    return;
  }
  const target = await pnpmTarget();
  if (!target) {
    return;
  }
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'pnpm'), `#!/bin/sh\nexec ${target} "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
}

/** A publishable workspace package, as `pnpm ls` reports it. */
export interface PublishablePackage {
  name: string;
  version: string;
  /** Absolute path to the package directory. */
  path: string;
}

interface ListedPackage {
  name?: string;
  version?: string;
  path: string;
  private?: boolean;
}

/**
 * The publishable workspace packages of `cwd`: those pnpm lists that are not private and have the
 * name and version publishing requires.
 */
export async function listPublishablePackages(cwd: string): Promise<PublishablePackage[]> {
  const result = await $({ cwd })`pnpm ls -r --json --depth -1`;
  const listed: ListedPackage[] = JSON.parse(result.stdout);

  return listed.flatMap((pkg) =>
    pkg.private || !pkg.name || !pkg.version
      ? []
      : [{ name: pkg.name, version: pkg.version, path: pkg.path }],
  );
}

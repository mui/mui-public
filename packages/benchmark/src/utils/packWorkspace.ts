/* eslint-disable no-console */

// Packs a workspace's public packages with `pnpm pack`, so each tarball is exactly what
// `pnpm publish` would upload — for installing a build the way a consumer installs a release.

import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import chalk from 'chalk';
import { mapAsync } from 'es-toolkit/array';
import { execa, parseCommandString } from 'execa';
import { resolveCommit } from './git';
import { listPublishablePackages } from './pnpm';

export interface PackedPackage {
  /** Package name from its package.json. */
  name: string;
  version: string;
  /** Absolute path to the packed `.tgz`. */
  tarball: string;
}

interface Manifest {
  /** The build command used, part of the cache key. */
  buildCmd: string;
  /** Tarball paths relative to the folder, so a restored cache still resolves. */
  packages: PackedPackage[];
}

export interface PackRefOptions {
  /** The repository the ref lives in; also where the worktree is added from. */
  repoRoot: string;
  /** A git ref (SHA, branch, or tag) to pack. */
  ref: string;
  /** Cache root. The packed folder lands at `<outRoot>/<sha>` and is reused on the next call. */
  outRoot: string;
  /**
   * Command run in the checkout to install before building. Defaults to a frozen-lockfile
   * `pnpm install`; pass `''` to skip installing.
   */
  installCmd?: string;
  /**
   * Command run in the checkout to build before packing. Defaults to `pnpm release:build`. Part of
   * the cache key.
   */
  buildCmd?: string;
}

const MANIFEST = 'manifest.json';

/** `@scope/pkg` → `scope+pkg.tgz`; `+` cannot appear in a package name, so no two collide. */
function tarballName(pkgName: string): string {
  return `${pkgName.replace(/^@/, '').replace('/', '+')}.tgz`;
}

/** Removes a temporary checkout, and git's record of it. */
async function removeCheckout(repoRoot: string, checkout: string): Promise<void> {
  await rm(checkout, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await execa('git', ['worktree', 'prune'], { cwd: repoRoot });
}

const CHECKOUT_RECORD_PREFIX = '.checkout-';

/**
 * Where a checkout's record is kept while it exists — which process made it, and where it is — next
 * to the packed refs.
 */
function checkoutRecordPathOf(outRoot: string, checkout: string): string {
  return path.join(outRoot, `${CHECKOUT_RECORD_PREFIX}${path.basename(checkout)}.json`);
}

interface CheckoutRecord {
  pid: number;
  checkout: string;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Removes the checkouts that interrupted runs left behind — those recorded by a process that is
 * no longer running, whatever stopped it — and their records. A live run's checkouts are its own.
 */
async function removeAbandonedCheckouts(repoRoot: string, outRoot: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(outRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(CHECKOUT_RECORD_PREFIX))
      .map(async (name) => {
        const recordPath = path.join(outRoot, name);
        const record: CheckoutRecord = JSON.parse(await readFile(recordPath, 'utf8'));
        if (!isRunning(record.pid)) {
          await removeCheckout(repoRoot, record.checkout);
          await rm(recordPath, { force: true });
        }
      }),
  );
}

/** Runs `buildCmd` in `cwd`, with the nx daemon off so nothing keeps writing after it returns. */
async function build(cwd: string, buildCmd: string): Promise<void> {
  const [file, ...args] = parseCommandString(buildCmd);
  await execa(file, args, {
    cwd,
    env: { NX_DAEMON: 'false' },
    stdio: 'inherit',
    verbose: 'short',
  });
}

/** Content hash of a file, short enough to live in a filename. */
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex').slice(0, 12);
}

/**
 * `dir`'s packages if it holds a cache of the requested build — built with the same `buildCmd`,
 * every tarball still present — or `null` otherwise.
 */
async function readFreshCache(dir: string, buildCmd: string): Promise<PackedPackage[] | null> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (manifest.buildCmd !== buildCmd) {
    return null;
  }
  const packages = manifest.packages.map((pkg) => ({
    ...pkg,
    tarball: path.join(dir, pkg.tarball),
  }));
  const present = await Promise.allSettled(packages.map((pkg) => access(pkg.tarball)));
  return present.every((result) => result.status === 'fulfilled') ? packages : null;
}

/**
 * Packs the already-built public workspace packages of `workspaceDir` into `outDir`.
 *
 * A public package that depends on a private workspace package cannot be installed from these —
 * the private one is never packed — which is a packaging bug in the ref, not something to hide here.
 */
async function packBuiltPackages(workspaceDir: string, outDir: string): Promise<PackedPackage[]> {
  await mkdir(outDir, { recursive: true });
  const packages = await listPublishablePackages(workspaceDir);
  if (packages.length === 0) {
    throw new Error(`No public workspace packages found in ${workspaceDir}.`);
  }
  // Each `pnpm pack` is a node process of its own.
  return mapAsync(
    packages,
    async ({ path: pkgDir, name, version }) => {
      const tarball = path.join(outDir, tarballName(name));
      await execa('pnpm', ['pack', '--out', tarball], { cwd: pkgDir, verbose: 'short' });
      return { name, version, tarball };
    },
    { concurrency: os.availableParallelism() },
  );
}

/**
 * Packs every public workspace package at `ref` into `<outRoot>/<sha>`, returning the packed
 * tarballs.
 *
 * The folder is cached by SHA: a later call for the same commit, built with the same `buildCmd`,
 * reuses it and skips the checkout, install and build. It is assembled in a staging folder and
 * renamed into place, so an interrupted run never leaves something that looks like a cache.
 */
export async function packRef(options: PackRefOptions): Promise<PackedPackage[]> {
  const {
    repoRoot,
    ref,
    outRoot,
    installCmd = 'pnpm install --frozen-lockfile --prefer-offline --config.engine-strict=false',
    buildCmd = 'pnpm release:build',
  } = options;

  const sha = await resolveCommit(repoRoot, ref);
  const dir = path.join(outRoot, sha);

  await removeAbandonedCheckouts(repoRoot, outRoot);
  const cached = await readFreshCache(dir, buildCmd);
  if (cached) {
    console.log(chalk.green(`\nReusing packed workspace for "${ref}" (${sha.slice(0, 9)}).`));
    return cached;
  }

  await mkdir(outRoot, { recursive: true });
  const staging = await mkdtemp(path.join(outRoot, '.staging-'));
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'pack-workspace-'));
  // Recorded until it is removed: a run stopped before its `finally` leaves the next one to remove
  // it.
  const recordPath = checkoutRecordPathOf(outRoot, checkout);
  const record: CheckoutRecord = { pid: process.pid, checkout };
  await writeFile(recordPath, JSON.stringify(record));
  try {
    console.log(chalk.cyan(`\nChecking out "${ref}" (${sha.slice(0, 9)}) at ${checkout}`));
    await execa('git', ['worktree', 'add', '--detach', checkout, sha], {
      cwd: repoRoot,
      verbose: 'short',
    });
    if (installCmd) {
      console.log(chalk.cyan(`\nInstalling dependencies for ${sha.slice(0, 9)}…`));
      const [installFile, ...installArgs] = parseCommandString(installCmd);
      await execa(installFile, installArgs, { cwd: checkout, stdio: 'inherit', verbose: 'short' });
    }
    console.log(chalk.cyan(`\nBuilding packages for ${sha.slice(0, 9)}…`));
    await build(checkout, buildCmd);

    const packages = await packBuiltPackages(checkout, staging);
    const manifest: Manifest = {
      buildCmd,
      packages: packages.map((pkg) => ({ ...pkg, tarball: path.basename(pkg.tarball) })),
    };
    // Written last: it is what marks the folder complete.
    await writeFile(path.join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    return packages.map((pkg) => ({ ...pkg, tarball: path.join(dir, path.basename(pkg.tarball)) }));
  } finally {
    // On success the staging folder has already become `dir`.
    await Promise.all([
      rm(staging, { recursive: true, force: true }),
      removeCheckout(repoRoot, checkout),
    ]);
    await rm(recordPath, { force: true });
  }
}

/**
 * Builds and packs the working tree into `outRoot`, naming each tarball by a hash of its bytes: an
 * unchanged build keeps its path, so an install that depends on it has nothing to redo.
 */
export async function packWorkingTree(options: {
  /** The workspace to build and pack. */
  repoRoot: string;
  /** Directory to hold the hashed tarballs. Replaced on each call. */
  outRoot: string;
  /** Command that builds the publishable packages. Defaults to `pnpm release:build`. */
  buildCmd?: string;
}): Promise<PackedPackage[]> {
  const { repoRoot, outRoot, buildCmd = 'pnpm release:build' } = options;

  console.log(chalk.cyan(`\nBuilding workspace packages for "working tree" (${buildCmd})…`));
  await build(repoRoot, buildCmd);

  console.log(chalk.cyan('\nPacking the working tree…'));
  await rm(outRoot, { recursive: true, force: true });
  const packed = await packBuiltPackages(repoRoot, outRoot);
  return Promise.all(
    packed.map(async (pkg) => {
      const hash = await hashFile(pkg.tarball);
      const tarball = path.join(outRoot, `${path.basename(pkg.tarball, '.tgz')}-${hash}.tgz`);
      await rename(pkg.tarball, tarball);
      return { ...pkg, tarball };
    }),
  );
}

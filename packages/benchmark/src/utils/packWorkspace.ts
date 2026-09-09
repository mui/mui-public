/* eslint-disable no-console */

import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import chalk from 'chalk';
import { execa, parseCommandString } from 'execa';
import { mapConcurrently } from './build';
import { run } from './exec';
import { pathExists } from './path';
import { listPublishablePackages } from './pnpm';

/**
 * Packs the public workspace packages at a given git ref into a folder of tarballs.
 *
 * The tarballs are produced with `pnpm pack`, so each is exactly what `pnpm publish` would upload —
 * honoring the package's `files`, `.npmignore`, and `publishConfig.directory`. That makes them
 * suitable for installing a ref's build the way a consumer would install a published release, which
 * is what benchmark harnesses and end-to-end install tests need.
 */

export interface PackedPackage {
  /** Package name from its package.json. */
  name: string;
  version: string;
  /** Absolute path to the packed `.tgz`. */
  tarball: string;
}

export interface PackedWorkspace {
  /** The ref that was packed, verbatim as given. */
  ref: string;
  /** The resolved commit SHA. */
  sha: string;
  /** Absolute path to the folder holding the tarballs and `manifest.json`. */
  dir: string;
  packages: PackedPackage[];
}

interface RawManifestPackage {
  name: string;
  version: string;
  /** Tarball name, relative to the folder, so the cache is relocatable. */
  tarball: string;
}

interface RawManifest {
  ref: string;
  sha: string;
  /** The build command used, part of the cache key. */
  buildCmd: string;
  packages: RawManifestPackage[];
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

/** Name of the file written into each packed folder describing its contents. */
const MANIFEST = 'manifest.json';

/** Resolves a git ref to its commit SHA. */
async function resolveCommit(repoRoot: string, ref: string): Promise<string> {
  const result = await execa('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not resolve git ref "${ref}": ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
}

/** Turns a package name into a filesystem-safe tarball basename (`@scope/pkg` → `scope-pkg.tgz`). */
export function tarballName(pkgName: string): string {
  return `${pkgName.replace(/^@/, '').replace(/\//g, '-')}.tgz`;
}

/**
 * Removes a temporary git worktree, best-effort.
 *
 * Removal can fail with "Directory not empty" when a background task runner (nx, via lerna)
 * repopulates the tree while git is deleting it; fall back to force-removing the directory and
 * pruning git's bookkeeping. Never throws — by the time this runs the packed tarballs are already
 * safe, so a leftover temp checkout must not fail the run.
 */
async function removeCheckout(repoRoot: string, checkout: string): Promise<void> {
  const removed = await execa('git', ['worktree', 'remove', '--force', checkout], {
    cwd: repoRoot,
    reject: false,
  });
  if (removed.exitCode !== 0) {
    try {
      await rm(checkout, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Could not remove temporary checkout ${checkout}: ${error instanceof Error ? error.message : error}. ` +
            `Delete it and prune git's bookkeeping to clean up.`,
        ),
      );
    }
    // Drop git's now-dangling admin entry regardless of whether the directory delete stuck.
    await execa('git', ['worktree', 'prune'], { cwd: repoRoot, reject: false });
  }
}

/**
 * Content hash of a file, short enough to live in a filename.
 *
 * Streamed rather than read whole: these are tarballs of built packages, and every one of them
 * would otherwise be resident at once.
 */
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex').slice(0, 12);
}

/** Reads a folder's raw `manifest.json`. */
async function readRawManifest(dir: string): Promise<RawManifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8'));
}

/** Resolves a raw manifest's stored (relative) tarball names to absolute paths under `dir`. */
function resolveManifest(raw: RawManifest, dir: string): PackedWorkspace {
  return {
    ref: raw.ref,
    sha: raw.sha,
    dir,
    packages: raw.packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      tarball: path.join(dir, pkg.tarball),
    })),
  };
}

/**
 * Returns `dir`'s manifest if it is a usable cache for the requested build — produced with the same
 * `buildCmd`, with every tarball it references still present — or `null` otherwise.
 *
 * Returning the parsed manifest lets the caller reuse it without a second read. Guards against
 * reusing a folder built with a different build script, or one whose tarballs were partially
 * evicted or deleted.
 */
export async function readFreshCache(dir: string, buildCmd: string): Promise<RawManifest | null> {
  if (!(await pathExists(path.join(dir, MANIFEST)))) {
    return null;
  }
  const raw = await readRawManifest(dir);
  if (raw.buildCmd !== buildCmd) {
    return null;
  }
  const tarballsPresent = await Promise.all(
    raw.packages.map((pkg) => pathExists(path.join(dir, pkg.tarball))),
  );
  return tarballsPresent.every(Boolean) ? raw : null;
}

/**
 * Packs the already-built public workspace packages of `checkoutDir` into `outDir`, one `.tgz` per
 * package. Packages must already be built.
 *
 * Uses pnpm's own workspace resolution rather than scanning a directory, so the set follows
 * `pnpm-workspace.yaml` and mirrors exactly what a release publishes.
 *
 * A public package that (transitively) depends on a *private* workspace package cannot be resolved
 * by a consumer — the private package is never packed, so `pnpm install` looks for it on the
 * registry and 404s. That is a real packaging bug in the ref, not something to paper over here:
 * make the internal dependency public so it ships alongside the package that needs it.
 */
export async function packBuiltPackages(
  checkoutDir: string,
  outDir: string,
): Promise<PackedPackage[]> {
  await mkdir(outDir, { recursive: true });
  const packages = await listPublishablePackages(checkoutDir);
  if (packages.length === 0) {
    throw new Error(`No public workspace packages found in ${checkoutDir}.`);
  }
  // Each `pnpm pack` is its own node process, so a repository with a dozen public packages would
  // otherwise start a dozen at once.
  return mapConcurrently(
    packages,
    async ({ path: pkgDir, name, version }) => {
      const tarball = path.join(outDir, tarballName(name));
      await run('pnpm', ['pack', '--out', tarball], pkgDir);
      return { name, version, tarball };
    },
    os.availableParallelism(),
  );
}

/**
 * Packs every public workspace package at `ref` into `<outRoot>/<sha>`, returning the folder and a
 * manifest of the packed tarballs.
 *
 * The build is deterministic for a commit, so the folder is cached by SHA: a later call for the
 * same commit reuses it and skips the checkout, install, and build entirely — but only when it was
 * built with the same `buildCmd` and its tarballs are all present, so the cache can never hand back
 * stale or mismatched output.
 *
 * On a cache miss the ref is checked out in a throwaway location, installed, built, and packed; the
 * checkout is then removed, so the small tarballs are the only lasting artifact. The folder is
 * assembled in a staging directory and atomically renamed into place, and its `manifest.json`
 * stores tarball names relative to the folder — so the cache is safe to move between machines (for
 * example restored from a CI cache under a different absolute path).
 */
export async function packRef(options: PackRefOptions): Promise<PackedWorkspace> {
  const {
    repoRoot,
    ref,
    outRoot,
    installCmd = 'pnpm install --frozen-lockfile --prefer-offline --config.engine-strict=false',
    buildCmd = 'pnpm release:build',
  } = options;

  const sha = await resolveCommit(repoRoot, ref);
  const dir = path.join(outRoot, sha);

  // Cache hit: reuse the folder only if it was built the same way and its tarballs are all present.
  const cached = await readFreshCache(dir, buildCmd);
  if (cached) {
    console.log(chalk.green(`\nReusing packed workspace for "${ref}" (${sha.slice(0, 9)}).`));
    return resolveManifest(cached, dir);
  }

  await mkdir(outRoot, { recursive: true });
  // Assemble in a staging sibling on the same filesystem so the final rename into `<outRoot>/<sha>`
  // is atomic — an interrupted run can never leave a partial folder that looks like a cache hit.
  const staging = await mkdtemp(path.join(outRoot, '.staging-'));
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'pack-workspace-'));
  try {
    console.log(chalk.cyan(`\nChecking out "${ref}" (${sha.slice(0, 9)}) at ${checkout}`));
    await run('git', ['worktree', 'add', '--detach', checkout, sha], repoRoot);
    if (installCmd) {
      console.log(chalk.cyan(`\nInstalling dependencies for ${sha.slice(0, 9)}…`));
      const [installFile, ...installArgs] = parseCommandString(installCmd);
      await run(installFile, installArgs, checkout);
    }
    console.log(chalk.cyan(`\nBuilding packages for ${sha.slice(0, 9)}…`));
    // Disable the nx daemon (lerna runs builds through nx): a lingering daemon keeps writing into
    // the checkout and makes removal fail with "Directory not empty". execa's `env` extends the
    // current environment, so only NX_DAEMON is overridden.
    const [buildFile, ...buildArgs] = parseCommandString(buildCmd);
    await run(buildFile, buildArgs, checkout, { NX_DAEMON: 'false' });

    const packages = await packBuiltPackages(checkout, staging);
    // Store tarballs by basename so the folder is relocatable; record buildCmd so a later run can
    // tell whether the cache matches. Write the manifest last — it marks completeness.
    const manifest: RawManifest = {
      ref,
      sha,
      buildCmd,
      packages: packages.map(({ name, version, tarball }) => ({
        name,
        version,
        tarball: path.basename(tarball),
      })),
    };
    await writeFile(path.join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    // Replace any pre-existing folder — a stale/partial one, or a mismatched cache we chose to
    // rebuild — so the rename can't fail with ENOTEMPTY.
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    return resolveManifest(manifest, dir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    // Runs even if the checkout failed (leaving an empty temp dir) — removeCheckout falls back to a
    // plain delete, so the temp checkout never leaks.
    await removeCheckout(repoRoot, checkout);
  }
}

/**
 * Builds and packs the working tree, naming each tarball by a hash of its bytes.
 *
 * A tarball path then never points at different content, which is what lets a consumer's installs
 * persist across runs: an unchanged build keeps its filename, so `pnpm install` has nothing to do,
 * while a changed one swaps a single package.
 *
 * The tree is mutable, so this always builds; a good `buildCmd` is cached (nx, turbo) and an
 * unchanged tree rebuilds in seconds.
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
  // Disable the nx daemon: it keeps writing into the workspace after the build returns.
  const [file, ...args] = parseCommandString(buildCmd);
  await run(file, args, repoRoot, { NX_DAEMON: 'false' });

  console.log(chalk.cyan('\nPacking the working tree…'));
  // Stage next to the destination so the renames cannot cross filesystems.
  const packedRoot = path.dirname(outRoot);
  await mkdir(packedRoot, { recursive: true });
  const staging = await mkdtemp(path.join(packedRoot, '.pack-'));
  try {
    const packed = await packBuiltPackages(repoRoot, staging);
    await rm(outRoot, { recursive: true, force: true });
    await mkdir(outRoot, { recursive: true });
    return await Promise.all(
      packed.map(async (pkg) => {
        const hash = await hashFile(pkg.tarball);
        const tarball = path.join(outRoot, `${path.basename(pkg.tarball, '.tgz')}-${hash}.tgz`);
        await rename(pkg.tarball, tarball);
        return { ...pkg, tarball };
      }),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Looks up one packed package's tarball by name, throwing a clear error if it was not packed. */
export function tarballFor(packages: PackedPackage[], name: string): string {
  const found = packages.find((pkg) => pkg.name === name);
  if (!found) {
    const available = packages.map((pkg) => pkg.name).join(', ') || '(none)';
    throw new Error(`Package "${name}" was not packed. Packed: ${available}.`);
  }
  return found.tarball;
}

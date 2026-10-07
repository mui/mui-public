/* eslint-disable no-console */

import * as path from 'node:path';
import { createRequire } from 'node:module';
import { constants, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { execa } from 'execa';
import type * as Vite from 'vite';
import { parse, stringify } from 'yaml';
// Self-referencing rather than `../../package.json`, which resolves only in the repository — see
// the note in ../cli/index.ts.
import pkgJson from '@mui/internal-benchmark/package.json' with { type: 'json' };
import type { PackedPackage } from '../utils/packWorkspace';
import { refLabel } from './refs';
import type { ResolvedRef } from './refs';

/**
 * Packages the run itself resolves from the harness, so they are never pinned to a ref's build: the
 * browser by the runner, and this package by the harness's own vite config.
 */
const RUNNER_ONLY_DEPS = ['@playwright/test', pkgJson.name];

/** The packed pins a run adds to the repository's overrides, leaving what the run resolves itself. */
function packedPins(packages: PackedPackage[]): Record<string, string> {
  return Object.fromEntries(
    packages
      .filter((pkg) => !RUNNER_ONLY_DEPS.includes(pkg.name))
      .map((pkg) => [pkg.name, `file:${pkg.tarball}`]),
  );
}

const MANIFEST = 'pnpm-workspace.yaml';
const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Copies `from` to `to`, and says whether it did: not when `from` doesn't exist, nor when `to`
 * already does and `mode` is `COPYFILE_EXCL`.
 */
async function tryCopy(from: string, to: string, mode?: number): Promise<boolean> {
  try {
    await copyFile(from, to, mode);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/** Where one of the repository's own files is kept while a run has it pinned. */
function backupPathOf(outputDir: string, file: string): string {
  return path.join(outputDir, `${file}.orig`);
}

/**
 * Sets one of the repository's files aside, unless an earlier ref of the run already did: that copy
 * is the original. A file the repository doesn't have is left alone.
 */
async function setAside(repoRoot: string, outputDir: string, file: string): Promise<void> {
  await tryCopy(path.join(repoRoot, file), backupPathOf(outputDir, file), constants.COPYFILE_EXCL);
}

/**
 * Points the repository's own install at this ref's packed build, through its overrides. The
 * manifest is rewritten from a copy set aside first, so a second ref pins over the original. The
 * lockfile is set aside too, so the restore can put back exactly the resolution the repository
 * had rather than resolve it again.
 */
async function pinPackedPackages(
  repoRoot: string,
  outputDir: string,
  packages: PackedPackage[],
): Promise<void> {
  // The lockfile first: the manifest's copy is what marks the repository pinned.
  await setAside(repoRoot, outputDir, LOCKFILE);
  await setAside(repoRoot, outputDir, MANIFEST);

  const manifestPath = path.join(repoRoot, MANIFEST);
  const config = parse(await readFile(backupPathOf(outputDir, MANIFEST), 'utf8')) ?? {};
  await writeFile(
    manifestPath,
    stringify({ ...config, overrides: { ...config.overrides, ...packedPins(packages) } }),
  );
}

/**
 * Installs the repository after its overrides changed. Not frozen: pnpm freezes the lockfile by
 * itself in CI, and changing it is the point.
 */
async function installWorkspace(repoRoot: string): Promise<void> {
  await execa('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
    cwd: repoRoot,
    verbose: 'short',
  });
}

/**
 * Puts the repository's manifest and lockfile back as they were, byte for byte, and installs from
 * them: the lockfile already satisfies the manifest, so nothing is resolved again.
 */
export async function restoreWorkspace(repoRoot: string, outputDir: string): Promise<void> {
  // No manifest set aside: nothing was pinned.
  if (!(await tryCopy(backupPathOf(outputDir, MANIFEST), path.join(repoRoot, MANIFEST)))) {
    return;
  }
  console.log(chalk.cyan('\nRestoring the repository install…'));
  // A repository without a lockfile had none to set aside.
  await tryCopy(backupPathOf(outputDir, LOCKFILE), path.join(repoRoot, LOCKFILE));
  await installWorkspace(repoRoot);
  // Removed only once the install is back, so an interrupted restore is retried by the next run.
  await Promise.all(
    [LOCKFILE, MANIFEST].map((file) => rm(backupPathOf(outputDir, file), { force: true })),
  );
}

/**
 * Builds the benchmark pages against one ref's packed build, in place with the harness's own vite
 * config, so only the library differs from a plain `vite build`. The pins stay until
 * `restoreWorkspace` puts the repository back.
 */
export async function buildRefPages(options: {
  /** The harness package directory, built in place. */
  harnessDir: string;
  /** The workspace root, whose overrides the tree inherits. */
  repoRoot: string;
  /** The ref being built. */
  ref: ResolvedRef;
  /** That ref's packed workspace packages. */
  packages: PackedPackage[];
  /** The run's output directory, where the manifest the run replaced is kept. */
  outputDir: string;
  /** Absolute output directory for the built pages. */
  outDir: string;
}): Promise<void> {
  const { harnessDir, repoRoot, ref, packages, outputDir, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${refLabel(ref)}"…`));

  await pinPackedPackages(repoRoot, outputDir, packages);
  await installWorkspace(repoRoot);

  // The harness's own vite, the version its pages are built with.
  const requireFromHarness = createRequire(path.join(harnessDir, 'package.json'));
  const vite: typeof Vite = await import(pathToFileURL(requireFromHarness.resolve('vite')).href);

  // `root` only points vite's config discovery at the harness; the harness's own plugin then moves
  // it to `src/`, the same as for a plain `vite build`.
  await vite.build({
    root: harnessDir,
    // Warnings and errors only: the run says what it builds, and the bundler's own progress lines go
    // to stdout, which stays free for what a caller asks for, such as a JSON report.
    logLevel: 'warn',
    build: { outDir },
  });
}

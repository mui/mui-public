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

/** Where the repository's own manifest is kept while a run has it pinned. */
function backupPathOf(outputDir: string): string {
  return path.join(outputDir, 'pnpm-workspace.yaml.orig');
}

/**
 * Points the repository's own install at this ref's packed build, through its overrides. The
 * manifest is rewritten from a copy set aside first, so a second ref pins over the original.
 */
async function pinPackedPackages(
  repoRoot: string,
  outputDir: string,
  packages: PackedPackage[],
): Promise<void> {
  const manifestPath = path.join(repoRoot, 'pnpm-workspace.yaml');
  const backupPath = backupPathOf(outputDir);
  // The first ref sets the repository's manifest aside; a later one finds that copy and keeps it.
  try {
    await copyFile(manifestPath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  const config = parse(await readFile(backupPath, 'utf8')) ?? {};
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

/** Puts the repository's manifest back, and installs from it. */
export async function restoreWorkspace(repoRoot: string, outputDir: string): Promise<void> {
  const backupPath = backupPathOf(outputDir);
  let original: string;
  try {
    original = await readFile(backupPath, 'utf8');
  } catch (error) {
    // No copy set aside: nothing was pinned.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  console.log(chalk.cyan('\nRestoring the repository install…'));
  await writeFile(path.join(repoRoot, 'pnpm-workspace.yaml'), original);
  await rm(backupPath, { force: true });
  await installWorkspace(repoRoot);
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
    logLevel: 'info',
    build: { outDir },
  });
}

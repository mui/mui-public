/* eslint-disable no-console */

import * as path from 'node:path';
import { createRequire } from 'node:module';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type * as Vite from 'vite';
import { parse, stringify } from 'yaml';
// Self-referencing rather than `../../package.json`, which resolves only in the repository — see
// the note in ../cli/index.ts.
import pkgJson from '@mui/internal-benchmark/package.json' with { type: 'json' };
import { run } from '../utils/exec';
import type { PackedPackage } from '../utils/packWorkspace';
import { refLabel } from './refs';
import type { ResolvedRef } from './refs';
import { pathExists } from '../utils/path';

/**
 * Packages the run itself resolves from the harness, so they are never pinned to a ref's build: the
 * browser by the runner, and this package by the harness's own vite config.
 */
const RUNNER_ONLY_DEPS = ['@playwright/test', pkgJson.name];

/**
 * The packed pins a run adds to the repository's overrides.
 *
 * Everything the run itself resolves is left alone, this package above all: pinning it would hand
 * the harness's vite config the ref's copy of the very tool doing the building, and a ref old enough
 * not to export the plugin then fails to configure at all.
 */
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
 * Points the repository's own install at this ref's packed build, through its overrides.
 *
 * The manifest is copied aside first and rewritten from that copy each time, so a second ref pins
 * over the original rather than over the first ref's pins. A run that dies leaves both the pins and
 * the copy: the manifest then names tarballs under the output directory, which fails the next
 * install rather than resolving something else and saying nothing.
 */
async function pinPackedPackages(
  repoRoot: string,
  outputDir: string,
  packages: PackedPackage[],
): Promise<void> {
  const manifestPath = path.join(repoRoot, 'pnpm-workspace.yaml');
  const backupPath = backupPathOf(outputDir);
  if (!(await pathExists(backupPath))) {
    await writeFile(backupPath, await readFile(manifestPath, 'utf8'));
  }

  const config = parse(await readFile(backupPath, 'utf8')) ?? {};
  await writeFile(
    manifestPath,
    stringify({ ...config, overrides: { ...config.overrides, ...packedPins(packages) } }),
  );
}

/**
 * Puts the repository's manifest back, and installs from it.
 *
 * The install is the point: without it the tree on disk still resolves the library to a tarball
 * under the output directory, and that surfaces at the next unrelated command instead of here.
 *
 * `--no-frozen-lockfile` because pnpm turns a frozen install on by itself in CI, and the lockfile
 * here still carries the pins this is undoing.
 */
export async function restoreWorkspace(repoRoot: string, outputDir: string): Promise<void> {
  const backupPath = backupPathOf(outputDir);
  if (!(await pathExists(backupPath))) {
    return;
  }
  console.log(chalk.cyan('\nRestoring the repository install…'));
  await writeFile(path.join(repoRoot, 'pnpm-workspace.yaml'), await readFile(backupPath, 'utf8'));
  await rm(backupPath, { force: true });
  await run('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], repoRoot);
}

/**
 * Builds the benchmark pages against one ref's packed build.
 *
 * The pages are built **where they live**, from the harness's own directory and its own vite config,
 * so a `benchmark run` build sees exactly what a plain `vite build` sees — the same tsconfig, the same
 * postcss config, the same everything. Only the library differs: the repository's install is pinned
 * to that ref's packed build first, so both sides resolve it the same way. Building one side through a
 * workspace link instead would compare two different resolution paths, and that difference would land
 * in the measurement rather than in the library.
 *
 * The pins stay until `restoreWorkspace` puts the repository back.
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
  // `--no-frozen-lockfile` because changing the overrides is the point, and pnpm turns a frozen
  // install on by itself in CI — where it would refuse the very change being made.
  await run('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], repoRoot);

  // vite is the harness's own, not this package's: the harness declares the version its pages are
  // built with, and the config being run is the harness's.
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

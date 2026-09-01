/* eslint-disable no-console */

import * as path from 'node:path';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { stringify } from 'yaml';
import { tarballFor } from '../utils/packWorkspace.mjs';
import { run } from './exec.mjs';

/**
 * Builds the benchmark pages for one ref, in an isolated install.
 *
 * Every ref goes through this, the working tree included, so both sides of a comparison resolve the
 * library the way a consumer installs it: from a tarball, through its own `exports` map and its own
 * dependency ranges. Building one side through a workspace link instead would compare two different
 * resolution paths, and that difference lands in the measurement rather than in the library.
 */

/**
 * @typedef {import('./refs.mjs').ResolvedRef} ResolvedRef
 * @typedef {import('../utils/packWorkspace.mjs').PackedPackage} PackedPackage
 */

/** Matches any filename vite accepts as its config. */
const VITE_CONFIG = /^vite\.config\.(?:[cm]?[jt]s)$/;

/**
 * Finds the harness's vite config file.
 *
 * @param {string} harnessDir - The harness package directory
 * @returns {Promise<string>} The config's basename
 */
async function findViteConfig(harnessDir) {
  const entries = await readdir(harnessDir);
  const found = entries.filter((entry) => VITE_CONFIG.test(entry)).sort();
  if (found.length === 0) {
    throw new Error(`No vite config found in ${harnessDir}.`);
  }
  return found[0];
}

/**
 * Runs the harness's vite build, emitting into `outDir`.
 *
 * The page entries come from the tachometer plugin in the harness's own config, so nothing about
 * which pages exist is passed here.
 *
 * @param {string} cwd - Directory holding the vite config and `src/`
 * @param {string} outDir - Absolute output directory
 * @returns {Promise<void>}
 */
export async function runViteBuild(cwd, outDir) {
  await run('pnpm', ['exec', 'vite', 'build', '--outDir', outDir], cwd);
}

/**
 * Rewrites a dependency map, pointing every `workspace:`-protocol entry at its packed tarball and
 * copying everything else verbatim.
 *
 * This is what lets the isolated install be derived rather than configured: the harness already
 * declares the library under test as `workspace:*`, so there is no library name to hardcode and no
 * hand-maintained list of versions to pin. Third-party dependencies — including the competitor
 * libraries a cross-library case compares against — come along unchanged, so every page builds
 * against every ref.
 *
 * @param {Record<string, string> | undefined} deps - A `dependencies` or `devDependencies` map
 * @param {PackedPackage[]} packages - The packed workspace packages
 * @param {string[]} [omit] - Dependency names to drop entirely
 * @returns {Record<string, string>}
 */
export function rewriteWorkspaceDeps(deps, packages, omit = []) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, version] of Object.entries(deps ?? {})) {
    if (omit.includes(name)) {
      continue;
    }
    out[name] = version.startsWith('workspace:') ? `file:${tarballFor(packages, name)}` : version;
  }
  return out;
}

/**
 * Replaces the install directory's `.env*` files with the harness's.
 *
 * Vite reads `VITE_*` variables from `.env*` files sitting next to the config, and a harness may
 * need one (a licence key, say). Stale files are cleared first, so removing one from the harness
 * removes it here too.
 *
 * @param {string} harnessDir - The harness package directory
 * @param {string} workDir - The isolated install directory
 * @returns {Promise<void>}
 */
async function syncEnvFiles(harnessDir, workDir) {
  const existing = (await readdir(workDir)).filter((name) => name.startsWith('.env'));
  await Promise.all(existing.map((name) => rm(path.join(workDir, name), { force: true })));

  const incoming = (await readdir(harnessDir)).filter((name) => name.startsWith('.env'));
  await Promise.all(
    incoming.map((name) => cp(path.join(harnessDir, name), path.join(workDir, name))),
  );
}

/**
 * Builds the benchmark pages against one ref's packed build, in an isolated install.
 *
 * `workDir` persists between runs and only its inputs are refreshed. Combined with tarball paths
 * that change only when their content does — a ref's embeds its commit SHA, the working tree's a
 * hash of its bytes — an unchanged run is a no-op install and a changed one swaps a single package.
 *
 * @param {Object} options - Build inputs
 * @param {string} options.harnessDir - The harness package directory, copied from
 * @param {ResolvedRef} options.ref - The ref being built
 * @param {PackedPackage[]} options.packages - That ref's packed workspace packages
 * @param {string} options.workDir - Persistent directory holding this ref's isolated install
 * @param {string} options.outDir - Absolute output directory for the built pages
 * @returns {Promise<void>}
 */
export async function buildRefPages(options) {
  const { harnessDir, ref, packages, workDir, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${ref.label}"…`));

  const viteConfig = await findViteConfig(harnessDir);
  await mkdir(workDir, { recursive: true });
  // Sources are replaced rather than overlaid, so a page deleted from the harness cannot linger.
  await rm(path.join(workDir, 'src'), { recursive: true, force: true });
  await cp(path.join(harnessDir, 'src'), path.join(workDir, 'src'), { recursive: true });
  await cp(path.join(harnessDir, viteConfig), path.join(workDir, viteConfig));
  await syncEnvFiles(harnessDir, workDir);

  const harnessPkg = JSON.parse(await readFile(path.join(harnessDir, 'package.json'), 'utf8'));
  await writeFile(
    path.join(workDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `tacho-bench-${ref.id}`,
        private: true,
        type: harnessPkg.type,
        dependencies: rewriteWorkspaceDeps(harnessPkg.dependencies, packages),
        // No page imports tachometer; installing it here would only slow every ref down, and it
        // pulls a chromedriver besides.
        devDependencies: rewriteWorkspaceDeps(harnessPkg.devDependencies, packages, ['tachometer']),
      },
      null,
      2,
    )}\n`,
  );

  // Marks this folder as its own workspace root, so pnpm does not walk up into the monorepo. The
  // overrides pin every packed workspace package, so a transitive dependency between them (whose
  // packed `workspace:*` became a concrete, unpublished version) resolves to a local build rather
  // than 404ing on the registry.
  await writeFile(
    path.join(workDir, 'pnpm-workspace.yaml'),
    stringify({
      overrides: Object.fromEntries(packages.map((pkg) => [pkg.name, `file:${pkg.tarball}`])),
    }),
  );

  // `--ignore-scripts`: this workspace has no build-script approvals, and pnpm fails an install
  // over unapproved ones rather than warning. Nothing installed here needs its scripts either — the
  // pages are built from the packages exactly as packed.
  await run(
    'pnpm',
    ['install', '--prefer-offline', '--ignore-scripts', '--config.engine-strict=false'],
    workDir,
  );
  await runViteBuild(workDir, outDir);
}

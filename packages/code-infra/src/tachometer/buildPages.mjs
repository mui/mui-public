/* eslint-disable no-console */

import * as path from 'node:path';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { tarballFor } from '../utils/packWorkspace.mjs';
import { run } from './exec.mjs';

/**
 * Builds the benchmark pages for one ref.
 *
 * The working tree builds in place: the harness is a workspace member depending on the library via
 * `workspace:*`, and `publishConfig.directory` makes that link resolve to the package's build
 * output, so vite resolves the built library with no packing and no isolated install.
 *
 * Any other ref was built in a throwaway checkout that has since been removed and SHA-cached as
 * tarballs, so its build is not in this workspace and cannot be reached by a workspace link. Those
 * pages are therefore built in an isolated install that consumes the library exactly as a published
 * release would install.
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
 * Builds the publishable workspace packages of a checkout.
 *
 * @param {string} checkoutDir - Checkout to build in
 * @param {string} buildCmd - The build command, e.g. `pnpm release:build`
 * @param {string} label - Human-readable ref label, for logging
 * @returns {Promise<void>}
 */
export async function buildPackages(checkoutDir, buildCmd, label) {
  console.log(chalk.cyan(`\nBuilding workspace packages for "${label}" (${buildCmd})…`));
  const [file, ...args] = buildCmd.split(' ').filter(Boolean);
  await run(file, args, checkoutDir);
}

/**
 * Builds the benchmark pages for the working tree, in place, against the workspace's own build.
 *
 * Rebuild the packages and re-run to measure a source change.
 *
 * @param {Object} options - Build inputs
 * @param {string} options.harnessDir - The harness package directory
 * @param {ResolvedRef} options.ref - The ref being built (the working tree)
 * @param {string} options.outDir - Absolute output directory
 * @returns {Promise<void>}
 */
export async function buildWorkspacePages(options) {
  const { harnessDir, ref, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${ref.label}"…`));
  await runViteBuild(harnessDir, outDir);
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
 * Builds the benchmark pages against a non-working-tree ref's build, in an isolated throwaway
 * package.
 *
 * The pages install the library as a `file:` dependency on its packed `.tgz`, exactly as a
 * published package would install, with every workspace-internal package pinned to its own tarball
 * via overrides. Third-party dependencies are pinned to the same versions as the committed harness,
 * so the only thing that varies between refs is the library build.
 *
 * @param {Object} options - Build inputs
 * @param {string} options.harnessDir - The harness package directory, copied from
 * @param {ResolvedRef} options.ref - The ref being built
 * @param {PackedPackage[]} options.packages - That ref's packed workspace packages
 * @param {string} options.workDir - Throwaway directory to assemble the isolated package in
 * @param {string} options.outDir - Absolute output directory
 * @returns {Promise<void>}
 */
export async function buildRefPages(options) {
  const { harnessDir, ref, packages, workDir, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${ref.label}"…`));

  const viteConfig = await findViteConfig(harnessDir);
  await cp(path.join(harnessDir, 'src'), path.join(workDir, 'src'), { recursive: true });
  await cp(path.join(harnessDir, viteConfig), path.join(workDir, viteConfig));

  const harnessPkg = JSON.parse(await readFile(path.join(harnessDir, 'package.json'), 'utf8'));
  await writeFile(
    path.join(workDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `tacho-bench-${ref.id}`,
        private: true,
        type: harnessPkg.type,
        dependencies: rewriteWorkspaceDeps(harnessPkg.dependencies, packages),
        // The isolated package only builds pages; tachometer itself runs from the real harness and
        // would pull chromedriver for nothing.
        devDependencies: rewriteWorkspaceDeps(harnessPkg.devDependencies, packages, ['tachometer']),
      },
      null,
      2,
    )}\n`,
  );

  // Pin every workspace-internal package to its packed tarball, so a transitive dependency between
  // them (whose packed `workspace:*` becomes a concrete, unpublished version) resolves to a local
  // build rather than the registry. In pnpm 11 `overrides` live in `pnpm-workspace.yaml`, not
  // `package.json`; writing one here also anchors this throwaway as its own workspace root, so pnpm
  // reads the overrides and never walks up to a parent workspace (which is why `--ignore-workspace`
  // — which would ignore this file — is not used).
  const overrides = packages.map((pkg) => `  '${pkg.name}': "file:${pkg.tarball}"`).join('\n');
  await writeFile(path.join(workDir, 'pnpm-workspace.yaml'), `overrides:\n${overrides}\n`);

  await run('pnpm', ['install', '--prefer-offline', '--config.engine-strict=false'], workDir);
  await runViteBuild(workDir, outDir);
}

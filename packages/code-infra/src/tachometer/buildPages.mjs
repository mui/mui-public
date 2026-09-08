/* eslint-disable no-console */

import * as path from 'node:path';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { parse, stringify } from 'yaml';
import { run } from '../utils/exec.mjs';
import { tarballFor } from '../utils/packWorkspace.mjs';
import { readPackageJson, writePackageJson } from '../utils/pnpm.mjs';

/**
 * Dependencies the run needs but a page never imports, so a ref's tree does without them.
 *
 * Every one is resolved from the harness rather than from here: the browser and its driver by the
 * runner, tachometer by the command that samples, and this package by the harness's own vite config
 * — which is loaded from the harness, since the build happens in place. Every one is also expensive
 * to install: tachometer pulls a chromedriver, `@playwright/test` a browser, and this package a
 * dependency tree many times the size of a harness.
 */
const RUNNER_ONLY_DEPS = [
  'tachometer',
  'chromedriver',
  '@playwright/test',
  // Read rather than spelled out: this is the one entry naming *this* package, and a rename that
  // left a literal behind would quietly restore a multi-minute install per ref.
  createRequire(import.meta.url)('../../package.json').name,
];

/**
 * @typedef {import('./refs.mjs').ResolvedRef} ResolvedRef
 * @typedef {import('../utils/packWorkspace.mjs').PackedPackage} PackedPackage
 */

/**
 * Rewrites a dependency map, pointing every `workspace:`-protocol entry at its packed tarball and
 * copying everything else verbatim.
 *
 * This is what lets the tree be derived rather than configured: the harness already declares the
 * library under test as `workspace:*`, so there is no library name to hardcode and no
 * hand-maintained list of versions to pin. Third-party dependencies — including the competitor
 * libraries a cross-library case compares against — come along unchanged, so every page builds
 * against every ref.
 *
 * @param {Partial<Record<string, string>> | undefined} deps - A `dependencies` or `devDependencies` map
 * @param {PackedPackage[]} packages - The packed workspace packages
 * @param {string[]} [omit] - Dependency names to drop entirely
 * @returns {Record<string, string>}
 */
function rewriteWorkspaceDeps(deps, packages, omit = []) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, version] of Object.entries(deps ?? {})) {
    if (version === undefined || omit.includes(name)) {
      continue;
    }
    out[name] = version.startsWith('workspace:') ? `file:${tarballFor(packages, name)}` : version;
  }
  return out;
}

/**
 * Reads the repository's `overrides`, so the ref's tree resolves the same dependency graph the
 * repository does.
 *
 * The tree is its own workspace root and inherits nothing. Without this, a repository that pins a
 * transitive dependency through an override would get a *different* graph here than in its real
 * install — quietly changing what is being benchmarked — and any policy the override exists to
 * satisfy (a blocked resolution, a security pin) would fail here too.
 *
 * @param {string} repoRoot - The workspace root to copy overrides from
 * @returns {Promise<Record<string, string>>}
 */
async function readOverrides(repoRoot) {
  try {
    const root = parse(await readFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
    return root?.overrides ?? {};
  } catch {
    return {};
  }
}

/**
 * A vite plugin that resolves every bare import from `treeDir` instead of from the harness.
 *
 * Bare specifiers only: a relative or absolute id belongs to the harness's own sources and stays
 * where it is. Resolution is handed back to vite with the importer rewritten, so vite's own
 * conditions (`browser`, `import`) and the target package's `exports` map still decide the answer —
 * which is what an alias to a directory would skip.
 *
 * @param {string} treeDir - The ref's installed tree
 * @returns {import('vite').Plugin}
 */
function resolveFromTree(treeDir) {
  // Resolution needs a base directory, and vite derives one from the importer's path — falling back
  // to the project root unless that path exists on disk, which would silently resolve the harness's
  // copy of a dependency instead of this ref's. The tree's own manifest is the file that names this
  // directory, the same way `createRequire` is pointed at one.
  const importer = path.join(treeDir, 'package.json');

  return {
    name: 'mui-code-infra:tachometer-resolve',
    enforce: 'pre',
    async resolveId(id, _importer, options) {
      if (id.startsWith('.') || path.isAbsolute(id) || id.startsWith('\0') || id.includes(':')) {
        return null;
      }
      return this.resolve(id, importer, { ...options, skipSelf: true });
    },
  };
}

/**
 * Installs one ref's packed build, with the harness's own dependencies around it.
 *
 * @param {Object} options - Install inputs
 * @param {string} options.harnessDir - The harness package directory, whose dependencies are copied
 * @param {string} options.repoRoot - The workspace root, whose overrides the tree inherits
 * @param {PackedPackage[]} options.packages - That ref's packed workspace packages
 * @param {string} options.treeDir - Where to install
 * @returns {Promise<void>}
 */
async function installRefTree({ harnessDir, repoRoot, packages, treeDir }) {
  const harnessPkg = await readPackageJson(harnessDir);
  await mkdir(treeDir, { recursive: true });

  await writePackageJson(treeDir, {
    name: 'tacho-resolve-tree',
    private: true,
    version: '0.0.0',
    dependencies: rewriteWorkspaceDeps(harnessPkg.dependencies, packages),
    devDependencies: rewriteWorkspaceDeps(harnessPkg.devDependencies, packages, RUNNER_ONLY_DEPS),
  });

  // Marks this folder as its own workspace root, so pnpm does not walk up into the monorepo. The
  // overrides carry the repository's own, then pin every packed workspace package on top — so a
  // transitive dependency between them (whose packed `workspace:*` became a concrete, unpublished
  // version) resolves to a local build rather than 404ing on the registry. The packed pins win,
  // since they are the whole point of this install.
  await writeFile(
    path.join(treeDir, 'pnpm-workspace.yaml'),
    stringify({
      overrides: {
        ...(await readOverrides(repoRoot)),
        ...Object.fromEntries(packages.map((pkg) => [pkg.name, `file:${pkg.tarball}`])),
      },
    }),
  );

  // `--ignore-scripts`: this workspace has no build-script approvals, and pnpm fails an install
  // over unapproved ones rather than warning. Nothing installed here needs its scripts either — the
  // pages are built from the packages exactly as packed.
  await run(
    'pnpm',
    ['install', '--prefer-offline', '--ignore-scripts', '--config.engine-strict=false'],
    treeDir,
  );
}

/**
 * Builds the benchmark pages against one ref's packed build.
 *
 * The pages are built **where they live**, from the harness's own directory and its own vite config,
 * so a `tacho run` build sees exactly what a plain `vite build` sees — the same tsconfig, the same
 * postcss config, the same everything. Only *resolution* differs: a plugin redirects every bare
 * import into a small tree installed for this ref, where the library under test is that ref's packed
 * build.
 *
 * That tree holds the harness's own dependencies too, so the pages and the library resolve React
 * (and everything else) to one copy. Building one side through a workspace link instead would
 * compare two different resolution paths, and that difference would land in the measurement rather
 * than in the library.
 *
 * @param {Object} options - Build inputs
 * @param {string} options.harnessDir - The harness package directory, built in place
 * @param {string} options.repoRoot - The workspace root, whose overrides the tree inherits
 * @param {ResolvedRef} options.ref - The ref being built
 * @param {PackedPackage[]} options.packages - That ref's packed workspace packages
 * @param {string} options.treeDir - Persistent directory holding this ref's installed tree
 * @param {string} options.outDir - Absolute output directory for the built pages
 * @returns {Promise<void>}
 */
export async function buildRefPages(options) {
  const { harnessDir, repoRoot, ref, packages, treeDir, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${ref.label}"…`));

  await installRefTree({ harnessDir, repoRoot, packages, treeDir });

  // vite is the harness's own, not this package's: the harness declares the version its pages are
  // built with, and the config being run is the harness's.
  const requireFromHarness = createRequire(path.join(harnessDir, 'package.json'));
  /** @type {typeof import('vite')} */
  const vite = await import(pathToFileURL(requireFromHarness.resolve('vite')).href);

  // `root` only points vite's config discovery at the harness; the harness's own plugin then moves
  // it to `src/`, the same as for a plain `vite build`.
  await vite.build({
    root: harnessDir,
    logLevel: 'warn',
    plugins: [resolveFromTree(treeDir)],
    build: { outDir },
  });
}

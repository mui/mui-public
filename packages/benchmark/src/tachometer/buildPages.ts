/* eslint-disable no-console */

import * as path from 'node:path';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type * as Vite from 'vite';
import { parse, stringify } from 'yaml';
// Self-referencing rather than `../../package.json`, which resolves only in the repository — see
// the note in ../cli/index.ts.
import pkgJson from '@mui/internal-benchmark/package.json' with { type: 'json' };
import { run } from '../utils/exec';
import { tarballFor } from '../utils/packWorkspace';
import type { PackedPackage } from '../utils/packWorkspace';
import { installedVersions, readPackageJson, writePackageJson } from '../utils/pnpm';
import { refLabel } from './format';
import type { ResolvedRef } from './refs';

/**
 * Dependencies the run needs but a page never imports, so a ref's tree does without them.
 *
 * Every one is resolved from the harness rather than from here: the browser and its driver by the
 * runner, tachometer by the command that samples, and this package by the harness's own vite config
 * — which is loaded from the harness, since the build happens in place. Every one is also expensive
 * to install: tachometer pulls a chromedriver, `@playwright/test` a browser, and this package a
 * dependency tree many times the size of a harness.
 */
const RUNNER_ONLY_DEPS = ['tachometer', 'chromedriver', '@playwright/test', pkgJson.name];

/**
 * A dependency map for a ref's tree: every `workspace:` entry points at that ref's packed tarball,
 * and everything else is pinned to the version the harness resolved rather than the range it
 * declares.
 *
 * The tree installs without the repository's lockfile, so a range would float to whatever is newest
 * at run time — a different library than the repository builds against, measured as if it were
 * ours.
 */
function rewriteWorkspaceDeps(
  installed: Map<string, string>,
  deps: Partial<Record<string, string>> | undefined,
  packages: PackedPackage[],
  omit: string[] = [],
): Record<string, string> {
  const entries = Object.entries(deps ?? {}).filter(
    ([name, version]) => version !== undefined && !omit.includes(name),
  ) as Array<[string, string]>;

  return Object.fromEntries(
    entries.map(([name, version]) =>
      version.startsWith('workspace:')
        ? [name, `file:${tarballFor(packages, name)}`]
        : [name, installed.get(name) ?? version],
    ),
  );
}

/**
 * Reads the repository's `overrides`, so the ref's tree resolves the same dependency graph the
 * repository does.
 *
 * The tree is its own workspace root and inherits nothing. Without this, a repository that pins a
 * transitive dependency through an override would get a *different* graph here than in its real
 * install — quietly changing what is being benchmarked — and any policy the override exists to
 * satisfy (a blocked resolution, a security pin) would fail here too.
 */
async function readOverrides(repoRoot: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  } catch (error) {
    // A repository without the file simply has no overrides. Anything else — a malformed file, a
    // permission error — would otherwise resolve the un-overridden graph and silently benchmark a
    // dependency set the repository never ships, which is the failure this function exists to avoid.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  return parse(raw)?.overrides ?? {};
}

/**
 * A vite plugin that resolves every bare import from `treeDir` instead of from the harness.
 *
 * Bare specifiers only: a relative or absolute id belongs to the harness's own sources and stays
 * where it is. Resolution is handed back to vite with the importer rewritten, so vite's own
 * conditions (`browser`, `import`) and the target package's `exports` map still decide the answer —
 * which is what an alias to a directory would skip.
 */
function resolveFromTree(treeDir: string): Vite.Plugin {
  // Resolution needs a base directory, and vite derives one from the importer's path — falling back
  // to the project root unless that path exists on disk, which would silently resolve the harness's
  // copy of a dependency instead of this ref's. The tree's own manifest is the file that names this
  // directory, the same way `createRequire` is pointed at one.
  const importer = path.join(treeDir, 'package.json');

  return {
    name: 'mui-benchmark:tachometer-resolve',
    enforce: 'pre',
    async resolveId(id, _importer, options) {
      if (id.startsWith('.') || path.isAbsolute(id) || id.startsWith('\0') || id.includes(':')) {
        return null;
      }
      return this.resolve(id, importer, { ...options, skipSelf: true });
    },
  };
}

/** Installs one ref's packed build, with the harness's own dependencies around it. */
async function installRefTree({
  harnessDir,
  repoRoot,
  packages,
  treeDir,
}: {
  /** The harness package directory, whose dependencies are copied. */
  harnessDir: string;
  /** The workspace root, whose overrides the tree inherits. */
  repoRoot: string;
  /** That ref's packed workspace packages. */
  packages: PackedPackage[];
  /** Where to install. */
  treeDir: string;
}): Promise<void> {
  const [harnessPkg, installed] = await Promise.all([
    readPackageJson(harnessDir),
    installedVersions(harnessDir),
    mkdir(treeDir, { recursive: true }),
  ]);

  await writePackageJson(treeDir, {
    name: 'tacho-resolve-tree',
    private: true,
    version: '0.0.0',
    dependencies: rewriteWorkspaceDeps(installed, harnessPkg.dependencies, packages),
    devDependencies: rewriteWorkspaceDeps(
      installed,
      harnessPkg.devDependencies,
      packages,
      RUNNER_ONLY_DEPS,
    ),
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
  /** Persistent directory holding this ref's installed tree. */
  treeDir: string;
  /** Absolute output directory for the built pages. */
  outDir: string;
}): Promise<void> {
  const { harnessDir, repoRoot, ref, packages, treeDir, outDir } = options;
  console.log(chalk.cyan(`\nBuilding benchmark pages for "${refLabel(ref)}"…`));

  await installRefTree({ harnessDir, repoRoot, packages, treeDir });

  // vite is the harness's own, not this package's: the harness declares the version its pages are
  // built with, and the config being run is the harness's.
  const requireFromHarness = createRequire(path.join(harnessDir, 'package.json'));
  const vite: typeof Vite = await import(pathToFileURL(requireFromHarness.resolve('vite')).href);

  // `root` only points vite's config discovery at the harness; the harness's own plugin then moves
  // it to `src/`, the same as for a plain `vite build`.
  await vite.build({
    root: harnessDir,
    logLevel: 'warn',
    plugins: [resolveFromTree(treeDir)],
    build: { outDir },
  });
}

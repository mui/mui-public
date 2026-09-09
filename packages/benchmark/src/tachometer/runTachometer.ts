/* eslint-disable no-console */

import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { execaSync } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef, packWorkingTree } from '../utils/packWorkspace';
import type { PackedPackage } from '../utils/packWorkspace';
import { createRefResolver } from './refs';
import type { ResolvedRef } from './refs';
import { discoverCases, pagesOf } from './discoverCases';
import type { BenchmarkCase } from './discoverCases';
import { buildRefPages } from './buildPages';
import { assertDriverMatchesBrowser, resolveBrowserBinary, withBrowserDefaults } from './browser';
import { summarizeCase } from './summarizeCase';
import { renderTachometerReport } from './renderReport';
import { getCiMetadata } from '../ciReport';
import { syncPrComment } from '../syncPrComment';
import { uploadCiReport } from './ciReport';
import type { TachometerReport } from './ciReport';
import { buildsDirOf, prepareOutputDir } from './outputDir';
import { run } from '../utils/exec';

/**
 * A case's name as a filename component. Names come from the benchmark's own `name`, so they are
 * prose rather than identifiers and may hold anything — a slash included.
 */
function fileSlugOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export interface RunTachometerOptions {
  /** The harness package directory (where the command was run). */
  harnessDir: string;
  /**
   * Only run cases whose path under `src` contains one of these substrings, case-insensitively.
   */
  filters?: string[];
  /** Binds the `baseline` symbol, in the ref grammar (e.g. `git:abc1234`). */
  baseline?: string;
  /** Branch PRs fork from. Defaults to detection via `origin/HEAD`. */
  baseBranch?: string;
  /**
   * Command that builds the publishable packages of a checked-out ref. Defaults to
   * `pnpm release:build`.
   */
  buildCmd?: string;
  /** Command that builds the working tree. Defaults to `buildCmd`. */
  workingTreeBuildCmd?: string;
  /** Whether to install inside a ref's checkout. Defaults to true. */
  install?: boolean;
  /** Where to write the combined JSON report. Defaults to `.tachometer/results/report.json`. */
  out?: string;
  /** Upload the report and refresh the pull request comment. */
  upload?: boolean;
}

/**
 * Benchmarks the harness's pages across one or more builds of the workspace with tachometer, and
 * writes a combined JSON report.
 *
 * Cases are the source of truth: the selected `tachometer.json` files determine which pages to
 * build, one variant is built per distinct ref, each url is then rewritten to that ref's built page,
 * and each case runs as its own tachometer invocation so its result is a clean table for that
 * scenario rather than a grid comparing unrelated scenarios against each other.
 */
export async function runTachometer(options: RunTachometerOptions): Promise<void> {
  const {
    harnessDir,
    filters = [],
    baseline,
    baseBranch,
    buildCmd = 'pnpm release:build',
    // A ref is built in a throwaway checkout with a cold task cache, so it wants the thorough
    // command. The working tree is rebuilt on every run and usually has a warm one, so a repository
    // can point this at the cached build instead without changing what is produced.
    workingTreeBuildCmd = buildCmd,
    install = true,
    out,
    upload = false,
  } = options;

  const repoRoot = await findWorkspaceDir(harnessDir);
  if (!repoRoot) {
    throw new Error(`Could not find a pnpm workspace root above ${harnessDir}.`);
  }

  // Everything a run writes goes under one directory, so a harness has one thing to ignore and
  // deleting it is the whole reset story. `packed` holds tarballs — a ref's keyed by commit SHA,
  // the working tree's by content hash — and is the one worth caching in CI; `trees` holds the
  // install each ref's pages resolve through, cheap to recreate and not portable between
  // containers, since its links point into a pnpm store; `builds` holds the pages built per ref;
  // `results` the report.
  const outputDir = await prepareOutputDir(harnessDir);
  const buildsDir = buildsDirOf(harnessDir);
  const packedDir = path.join(outputDir, 'packed');
  const treesDir = path.join(outputDir, 'trees');

  const resolver = createRefResolver({ repoRoot, baseBranch, baselineOverride: baseline });
  const cases = await discoverCases({ harnessDir, filters, resolveRef: resolver.parse });

  const refs = new Map<string, ResolvedRef>();
  for (const entry of cases) {
    for (const leaf of entry.leaves) {
      if (leaf.ref) {
        refs.set(leaf.ref.id, leaf.ref);
      }
    }
  }

  // Show the resolved commit next to each ref — a symbolic baseline (e.g. "merge-base with
  // upstream/master") otherwise hides which commit it actually chose, which matters when several
  // base branches exist and only the closest fork point is used.
  const describeRef = (ref: ResolvedRef) =>
    ref.sha ? `${ref.label} (${ref.sha.slice(0, 9)})` : ref.label;

  // Before any build: a driver that cannot open the browser fails the run either way, and finding
  // out now costs seconds instead of minutes of packing and installing.
  const browserBinary = await resolveBrowserBinary(harnessDir);
  assertDriverMatchesBrowser(harnessDir, browserBinary);
  // `getuid` is POSIX-only; on Windows nobody is root.
  const asRoot = process.getuid?.() === 0;

  console.log(chalk.cyan(`Cases:   ${cases.map((entry) => entry.name).join(', ')}`));
  console.log(chalk.cyan(`Pages:   ${pagesOf(cases).join(', ')}`));
  console.log(chalk.cyan(`Refs:    ${[...refs.values()].map(describeRef).join(', ')}`));
  console.log(
    chalk.cyan(`Browser: ${browserBinary}${asRoot ? ' (as root, so without its sandbox)' : ''}`),
  );

  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'tacho-'));

  try {
    // Build one variant per distinct ref, each resolving through its own install so both sides
    // of a comparison resolve the library identically.
    for (const ref of refs.values()) {
      let packages: PackedPackage[];
      if (ref.kind === 'worktree') {
        // eslint-disable-next-line no-await-in-loop
        packages = await packWorkingTree({
          repoRoot,
          outRoot: path.join(packedDir, 'current'),
          buildCmd: workingTreeBuildCmd,
        });
      } else {
        // packRef caches a ref's tarballs by SHA; a hit skips the checkout, install, and build.
        // eslint-disable-next-line no-await-in-loop
        const packed = await packRef({
          repoRoot,
          ref: ref.committish,
          outRoot: packedDir,
          // An empty install command means "skip"; otherwise packRef's default install runs.
          installCmd: install ? undefined : '',
          buildCmd,
        });
        packages = packed.packages;
      }

      // eslint-disable-next-line no-await-in-loop
      await buildRefPages({
        harnessDir,
        repoRoot,
        ref,
        packages,
        treeDir: path.join(treesDir, ref.id),
        outDir: path.join(buildsDir, ref.id),
      });
    }

    // Rewrite each leaf url to its ref's built page, then run each case's own config. Tachometer
    // resolves relative urls against the config file's directory and these configs are written to a
    // temp dir, so the rewritten urls are absolute.
    const results: Array<{ entry: BenchmarkCase; json: any }> = [];
    for (const entry of cases) {
      for (const leaf of entry.leaves) {
        const refId = leaf.ref ? leaf.ref.id : 'current';
        leaf.node.url = `${path.join(buildsDir, refId, leaf.page)}${leaf.suffix}`;
      }
      // Discovery flattened `expand` away, so every benchmark already carries its own effective
      // browser and there is no inheritance left to walk.
      for (const benchmark of entry.config.benchmarks ?? []) {
        benchmark.browser = withBrowserDefaults(benchmark.browser, browserBinary, asRoot);
      }
      const slug = fileSlugOf(entry.name);
      const configPath = path.join(tmpBase, `tachometer-${slug}.json`);
      // eslint-disable-next-line no-await-in-loop
      await writeFile(
        configPath,
        // Served from the output directory rather than the harness: tachometer's static server is
        // koa-static with its default `hidden: false`, so any dot-prefixed segment in the *served*
        // path is refused. Rooting here keeps `.tachometer` out of the url entirely.
        `${JSON.stringify({ ...entry.config, root: outputDir }, null, 2)}\n`,
      );

      console.log(chalk.cyan(`\nRunning "${entry.name}"…`));
      const jsonPath = path.join(tmpBase, `result-${slug}.json`);
      // eslint-disable-next-line no-await-in-loop
      await run(
        'pnpm',
        ['exec', 'tachometer', '--config', configPath, '--json-file', jsonPath],
        harnessDir,
      );
      // Cases run sequentially on purpose — concurrent browser benchmarks would contend for the
      // same machine and skew timings — so reading each result in turn is fine.
      // eslint-disable-next-line no-await-in-loop
      results.push({ entry, json: JSON.parse(await readFile(jsonPath, 'utf8')) });
    }

    const outPath = out ? path.resolve(out) : path.join(outputDir, 'results', 'report.json');
    const report = {
      // Consumers render reports from several benchmark axes; the pair identifies which one this
      // is and how to read it.
      version: 1,
      reportType: 'tachometer' as const,
      generatedAt: new Date().toISOString(),
      head: {
        ref: 'HEAD',
        sha: execaSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim(),
        branch: execaSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: repoRoot,
        }).stdout.trim(),
      },
      browser: browserBinary,
      // Symbols are resolved to concrete SHAs here so a run stays interpretable after the fact.
      refs: [...refs.values()].map((ref) => ({
        id: ref.id,
        kind: ref.kind,
        label: ref.label,
        sha: ref.sha,
      })),
      // Summarising is best-effort per case: a case that produced no usable benchmarks must not
      // cost the whole run its report, since `raw` below is the only surviving copy of every other
      // case's samples once the temp dir is cleaned up.
      cases: results.map(({ entry, json }) => {
        try {
          return summarizeCase(entry, json);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.yellow(`Could not summarize "${entry.name}": ${message}`));
          return { name: entry.name, error: message };
        }
      }),
      raw: Object.fromEntries(results.map(({ entry, json }) => [entry.name, json])),
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('');
    renderTachometerReport(report);
    console.log(chalk.green(`\nWrote JSON report to ${outPath}`));

    if (upload) {
      await publishReport(report);
    }
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}

/**
 * Uploads a report and refreshes the pull request comment.
 *
 * A failure to refresh the comment does not fail the run: the numbers are already measured, written
 * and uploaded, and losing them to a comment API hiccup would waste the whole benchmark.
 */
async function publishReport(report: TachometerReport): Promise<void> {
  const metadata = await getCiMetadata();
  if (!metadata.repo) {
    console.warn(
      chalk.yellow('Skipping upload: no repository detected, which usually means this is not CI.'),
    );
    return;
  }

  await uploadCiReport({ version: 1, reportType: 'tachometer', ...metadata, report });

  try {
    console.log('Syncing PR comment via the dashboard API…');
    const result = await syncPrComment(metadata.repo);
    console.log(
      result.skipped ? 'No open PR found for this branch, skipping.' : 'PR comment synced.',
    );
  } catch (error) {
    console.error(
      chalk.yellow(
        `Failed to sync the PR comment: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}

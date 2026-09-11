/* eslint-disable no-console */

import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { execaSync } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef, packWorkingTree } from '../utils/packWorkspace';
import type { PackedPackage } from '../utils/packWorkspace';
import { resolveBaselineRef, WORKTREE_REF } from './refs';
import type { ResolvedRef } from './refs';
import { discoverCases, pagesOf } from './discoverCases';
import type { BenchmarkCase, Leaf } from './discoverCases';
import { isSummarized, refLabel } from './format';
import { buildRefPages, restoreWorkspace } from './buildPages';
import type { ResolveMode } from './buildPages';
import { assertDriverMatchesBrowser, resolveBrowserBinary, withBrowserDefaults } from './browser';
import { summarizeCase } from './summarizeCase';
import { renderTachometerReport } from './renderReport';
import { getCiMetadata } from '../ciReport';
import { syncPrComment } from '../syncPrComment';
import { uploadCiReport } from './ciReport';
import type { CaseResult, TachometerReport } from './ciReport';
import { buildsDirOf, prepareOutputDir } from './outputDir';
import { run } from '../utils/exec';

/**
 * A case's name as a filename component. Names come from the benchmark's own `name`, so they are
 * prose rather than identifiers and may hold anything — a slash included.
 */
function fileSlugOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * The builds a run measures, and which of them a given variant loads.
 *
 * The baseline is resolved only when a case compares against it: a harness that only puts pages
 * side by side needs no second commit, and asking for one would fail in a clone too shallow to hold
 * it. The lookup comes back with the list so that "there is no baseline" is settled once, here,
 * rather than being a case every later step has to allow for.
 */
async function resolveBuilds(
  cases: BenchmarkCase[],
  baseline: string | undefined,
  repoRoot: string,
): Promise<{ refs: ResolvedRef[]; buildFor: (leaf: Leaf) => ResolvedRef }> {
  if (!cases.some((entry) => entry.comparison === 'baseline')) {
    return { refs: [WORKTREE_REF], buildFor: () => WORKTREE_REF };
  }
  const baselineRef = await resolveBaselineRef(baseline, repoRoot);
  return {
    refs: [WORKTREE_REF, baselineRef],
    buildFor: (leaf) => (leaf.ref === 'baseline' ? baselineRef : WORKTREE_REF),
  };
}

export interface RunTachometerOptions {
  /** The harness package directory (where the command was run). */
  harnessDir: string;
  /**
   * Only run cases whose path under `src` contains one of these substrings, case-insensitively.
   */
  filters?: string[];
  /**
   * The build every `[baseline]` variant loads: a revision, on its own or as `git:<rev>`. Defaults
   * to `HEAD~1`.
   */
  baseline?: string;
  /**
   * Command that builds the publishable workspace packages. Run for every ref — in each ref's own
   * checkout, and in the working tree — so both sides of a comparison are built the same way.
   * Defaults to `pnpm release:build`.
   */
  buildCmd?: string;
  /** Whether to install inside a ref's checkout. Defaults to true. */
  install?: boolean;
  /** Where to write the combined JSON report. Defaults to `.tachometer/results/report.json`. */
  out?: string;
  /** Upload the report and refresh the pull request comment. */
  upload?: boolean;
  /** How a ref's pages find the library under test. Defaults to `in-place`. */
  resolveMode?: ResolveMode;
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
    buildCmd = 'pnpm release:build',
    install = true,
    out,
    upload = false,
    resolveMode = 'in-place',
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

  // A run killed outright — Ctrl-C, not a thrown error — never reaches the restore below, leaving
  // the repository pinned to tarballs. The copy it left behind is how that is noticed, so put it
  // back before doing anything else, whatever mode this run is in.
  await restoreWorkspace(repoRoot, outputDir);

  const cases = await discoverCases({ harnessDir, filters });
  const { refs, buildFor } = await resolveBuilds(cases, baseline, repoRoot);

  // The commit follows the name, so a revision like `HEAD~1` still says which commit it landed on.
  const describeRef = (ref: ResolvedRef) =>
    ref.sha ? `${refLabel(ref)} (${ref.sha.slice(0, 9)})` : refLabel(ref);

  // Before any build: a driver that cannot open the browser fails the run either way, and finding
  // out now costs seconds instead of minutes of packing and installing.
  const browserBinary = await resolveBrowserBinary(harnessDir);
  assertDriverMatchesBrowser(harnessDir, browserBinary);
  // `getuid` is POSIX-only; on Windows nobody is root.
  const asRoot = process.getuid?.() === 0;

  // What each case compares, so one that carries no baseline says so up front rather than through
  // an empty regression list at the end.
  const describeCase = (entry: BenchmarkCase) =>
    entry.comparison === 'baseline'
      ? `${entry.name} (vs baseline)`
      : `${entry.name} (${entry.variants.length} variants)`;

  console.log(chalk.cyan(`Cases:   ${cases.map(describeCase).join(', ')}`));
  console.log(chalk.cyan(`Pages:   ${pagesOf(cases).join(', ')}`));
  console.log(chalk.cyan(`Refs:    ${refs.map(describeRef).join(', ')}`));
  console.log(
    chalk.cyan(`Browser: ${browserBinary}${asRoot ? ' (as root, so without its sandbox)' : ''}`),
  );

  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'tacho-'));

  try {
    // Build one variant per distinct ref, each resolving through its own install so both sides
    // of a comparison resolve the library identically.
    for (const ref of refs) {
      let packages: PackedPackage[];
      if (ref.kind === 'worktree') {
        // eslint-disable-next-line no-await-in-loop
        packages = await packWorkingTree({
          repoRoot,
          outRoot: path.join(packedDir, 'current'),
          buildCmd,
        });
      } else {
        // packRef caches a ref's tarballs by SHA; a hit skips the checkout, install, and build.
        // eslint-disable-next-line no-await-in-loop
        const packed = await packRef({
          repoRoot,
          ref: ref.sha,
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
        outputDir,
        outDir: path.join(buildsDir, ref.id),
        resolveMode,
      });
    }

    // Rewrite each leaf url to its ref's built page, then run each case's own config. Tachometer
    // resolves relative urls against the config file's directory and these configs are written to a
    // temp dir, so the rewritten urls are absolute.
    const results: Array<{ entry: BenchmarkCase; json: any }> = [];
    for (const entry of cases) {
      for (const leaf of entry.leaves) {
        leaf.node.url = `${path.join(buildsDir, buildFor(leaf).id, leaf.page)}${leaf.suffix}`;
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
      version: 1 as const,
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
      refs,
      // Summarising is best-effort per case: a case that produced no usable benchmarks must not
      // cost the whole run its report, since `raw` below is the only surviving copy of every other
      // case's samples once the temp dir is cleaned up.
      cases: results.map(({ entry, json }): CaseResult => {
        try {
          return summarizeCase(entry, json);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.yellow(`Could not summarize "${entry.name}": ${message}`));
          return { name: entry.name, comparison: entry.comparison, error: message };
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

    // Written and uploaded first, so the errors are readable and the comment says what happened —
    // then fail, because a harness that measured nothing at all otherwise reports a passing job.
    if (report.cases.every((entry) => !isSummarized(entry))) {
      throw new Error('No case produced any measurement.');
    }
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
    // Always, including after a failure: an in-place run leaves the repository resolving the library
    // to a tarball until this puts it back.
    if (resolveMode === 'in-place') {
      await restoreWorkspace(repoRoot, outputDir);
    }
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

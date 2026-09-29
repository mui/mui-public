/* eslint-disable no-console */

import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { execa } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef, packWorkingTree } from '../utils/packWorkspace';
import { resolveCommit } from '../utils/git';
import type { BenchmarkRunReport } from '../runReport';
import { refLabel, resolveBaselineRef, variantOf, WORKTREE_REF } from './refs';
import type { ResolvedRef } from './refs';
import { discoverBenchFiles } from './benchFiles';
import { runInterleaved } from './runInterleaved';
import { buildRefPages, restoreWorkspace } from './buildPages';
import { resolveBrowserBinary } from './browser';
import { printRunReport } from './printReport';
import { publishRunReport } from './upload';
import { buildsDirOf, prepareOutputDir, resultsPathOf } from './outputDir';

export interface RunBenchmarksOptions {
  /** The harness package directory (where the command was run). */
  harnessDir: string;
  /** Only run benchmark files whose path under `src` contains one of these, case-insensitively. */
  filters?: string[];
  /**
   * The build the working tree is compared against: a revision, on its own or as `git:<rev>`.
   * Defaults to `HEAD~1`, the parent commit.
   */
  baseline?: string;
  /**
   * Command that builds the publishable workspace packages. Run for every ref — in each ref's own
   * checkout, and in the working tree — so both sides of a comparison are built the same way.
   * Defaults to `pnpm release:build`.
   */
  buildCmd?: string;
  /** Where to write the JSON report. Defaults to `.benchmark/results/report.json`. */
  out?: string;
  /** Upload the report and refresh the pull request comment. */
  upload?: boolean;
}

/** Measured rounds per benchmark; each round samples every variant once. */
const SAMPLES = 30;
/** Discarded rounds before measuring, once per benchmark. */
const WARMUP = 10;

/**
 * Benchmarks a harness's `*.bench.tsx` files across two builds of the workspace — the working tree
 * and a baseline — and writes, prints and optionally uploads the run report.
 *
 * Both builds are packed from their own commit and installed into the harness the same way, so
 * neither resolves the library through a workspace link.
 */
export async function runBenchmarks(options: RunBenchmarksOptions): Promise<BenchmarkRunReport> {
  const {
    harnessDir,
    filters = [],
    baseline,
    buildCmd = 'pnpm release:build',
    out,
    upload = false,
  } = options;

  const repoRoot = await findWorkspaceDir(harnessDir);
  if (!repoRoot) {
    throw new Error(`Could not find a pnpm workspace root above ${harnessDir}.`);
  }

  // Everything a run writes goes under one directory, so a harness has one thing to ignore and
  // deleting it is the whole reset story. `packed` holds tarballs — a ref's keyed by commit SHA,
  // the working tree's by content hash — and is the one worth caching in CI; `builds` holds the
  // pages built per ref; `results` the report.
  const outputDir = await prepareOutputDir(harnessDir);
  const buildsDir = buildsDirOf(harnessDir);
  const packedDir = path.join(outputDir, 'packed');

  // A run killed outright — Ctrl-C, not a thrown error — never reaches the restore below, leaving
  // the repository pinned to tarballs. The copy it left behind is how that is noticed, so put it
  // back before doing anything else.
  await restoreWorkspace(repoRoot, outputDir);

  const benchFiles = await discoverBenchFiles({ harnessDir, filters });
  if (benchFiles.length === 0) {
    const srcDir = path.join(harnessDir, 'src');
    throw new Error(
      filters.length > 0
        ? `No *.bench.tsx file under ${srcDir} matches ${filters.map((filter) => `"${filter}"`).join(', ')}.`
        : `No *.bench.tsx file found under ${srcDir}.`,
    );
  }
  // The working tree first: it is the reference every comparison is judged from.
  const refs: ResolvedRef[] = [WORKTREE_REF, await resolveBaselineRef(baseline, repoRoot)];

  // Before any build: a browser that is not installed fails the run either way, and finding out now
  // costs seconds instead of minutes of packing and installing.
  const browserBinary = await resolveBrowserBinary(harnessDir);
  // `getuid` is POSIX-only; on Windows nobody is root. Chrome cannot enter its sandbox as root.
  const launchArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];

  // The commit follows the name, so a revision like `HEAD~1` still says which commit it landed on.
  const describeRef = (ref: ResolvedRef) =>
    ref.sha ? `${refLabel(ref)} (${ref.sha.slice(0, 9)})` : refLabel(ref);
  console.log(chalk.cyan(`Files:   ${benchFiles.map((benchFile) => benchFile.file).join(', ')}`));
  console.log(chalk.cyan(`Refs:    ${refs.map(describeRef).join(', ')}`));
  console.log(chalk.cyan(`Browser: ${browserBinary} ${launchArgs.join(' ')}`));

  try {
    // Pack both sides at once: each builds in its own checkout, and nothing is measured yet.
    const packedByRef = await Promise.all(
      refs.map(async (ref) => {
        if (ref.kind === 'worktree') {
          return packWorkingTree({ repoRoot, outRoot: path.join(packedDir, 'current'), buildCmd });
        }
        // packRef caches a ref's tarballs by SHA; a hit skips the checkout, install, and build.
        const packed = await packRef({ repoRoot, ref: ref.sha, outRoot: packedDir, buildCmd });
        return packed.packages;
      }),
    );

    // Then build one set of pages per ref, each against its own packed build so both sides of a
    // comparison resolve the library identically. One at a time: a build pins the repository's own
    // workspace file.
    for (const [index, ref] of refs.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await buildRefPages({
        harnessDir,
        repoRoot,
        ref,
        packages: packedByRef[index],
        outputDir,
        outDir: path.join(buildsDir, ref.id),
      });
    }

    const results = await runInterleaved({
      buildsDir,
      benchFiles,
      benchRefs: refs,
      browserBinary,
      launchArgs,
      samples: SAMPLES,
      warmup: WARMUP,
    });

    const report: BenchmarkRunReport = {
      version: 2,
      generatedAt: new Date().toISOString(),
      head: {
        sha: await resolveCommit(repoRoot, 'HEAD'),
        branch: (await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }))
          .stdout,
      },
      environment: {
        browser: `Chromium ${results.browserVersion}`,
        platform: process.platform,
        arch: process.arch,
        launchArgs,
      },
      sampling: { samples: SAMPLES, warmup: WARMUP },
      builds: Object.fromEntries(
        refs.map((ref) => [variantOf(ref), { sha: ref.sha, label: refLabel(ref) }]),
      ),
      metrics: results.metrics,
      benchmarks: results.benchmarks,
    };

    const outPath = out ? path.resolve(out) : resultsPathOf(harnessDir);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('');
    printRunReport(report);
    console.log(chalk.green(`\nWrote JSON report to ${outPath}`));

    if (upload) {
      await publishRunReport(report);
    }

    // Written and uploaded first, so the errors are readable and the comment says what happened —
    // then fail, because a harness that measured nothing at all otherwise reports a passing job.
    if (report.benchmarks.every((benchmark) => benchmark.error !== undefined)) {
      throw new Error('No benchmark produced any measurement.');
    }
    return report;
  } finally {
    // Always, including after a failure: the repository resolves the library to a tarball until
    // this puts it back.
    await restoreWorkspace(repoRoot, outputDir);
  }
}

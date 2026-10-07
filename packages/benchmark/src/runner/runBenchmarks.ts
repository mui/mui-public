/* eslint-disable no-console */

import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef, packWorkingTree } from '../utils/packWorkspace';
import { getCiMetadata } from '../ciReport';
import { summarizeRun } from '../runReport';
import type { BenchmarkRunReport } from '../runReport';
import type { SamplingOptions } from '../sampling';
import { refLabel, resolveBaselineRef, WORKTREE_REF } from './refs';
import type { ResolvedRef } from './refs';
import { discoverBenchFiles } from './benchFiles';
import { runInterleaved } from './runInterleaved';
import { buildRefPages, restoreWorkspace } from './buildPages';
import { resolveBrowserBinary } from './browser';
import { printRunReport } from './printReport';
import { publishRunReport } from './upload';
import { buildsDirOf, prepareOutputDir, resultsPathOf } from './outputDir';

/** Fewer logical CPUs than this starve V8's background compilers. */
const MIN_CPUS = 3;

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
  /** Sampling options that override every benchmark's own, for the whole run. */
  sampling?: SamplingOptions;
  /** Only run benchmarks whose name matches this regular expression, like Vitest's `-t`. */
  testNamePattern?: string;
  /**
   * How the results are printed: `default`, tables for reading, or `json`, the analysis as JSON on
   * stdout — medians, intervals and verdicts — for a program to read.
   */
  reporter?: 'default' | 'json';
}

/**
 * Benchmarks a harness's `*.bench.tsx` files across two builds of the workspace — the working tree
 * and a baseline — and writes, prints and optionally uploads the run report.
 *
 * Both builds are packed from their own commit and installed into the harness the same way, so
 * neither resolves the library through a workspace link.
 */
export async function runBenchmarks(options: RunBenchmarksOptions): Promise<BenchmarkRunReport> {
  const startedAt = Date.now();
  const {
    harnessDir,
    filters = [],
    baseline,
    buildCmd = 'pnpm release:build',
    out,
    upload = false,
    sampling,
    testNamePattern,
    reporter = 'default',
  } = options;
  // Compiled before anything is built, so a bad pattern fails at once.
  const namePattern = testNamePattern === undefined ? undefined : new RegExp(testNamePattern);

  const repoRoot = await findWorkspaceDir(harnessDir);
  if (!repoRoot) {
    throw new Error(`Could not find a pnpm workspace root above ${harnessDir}.`);
  }

  // `packed` holds tarballs — a ref's keyed by commit SHA, the working tree's by content hash — and is
  // the one worth caching in CI.
  const outputDir = await prepareOutputDir(harnessDir);
  const buildsDir = buildsDirOf(harnessDir);
  const packedDir = path.join(outputDir, 'packed');

  // A run killed outright never reaches the restore below; undo what it left pinned first.
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

  // Before any build, so a missing browser fails in seconds rather than after the packing.
  const browserBinary = await resolveBrowserBinary(harnessDir);
  // `getuid` is POSIX-only; on Windows nobody is root. Chrome cannot enter its sandbox as root.
  const launchArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];

  // The commit follows the name, so a revision like `HEAD~1` still says which commit it landed on.
  const describeRef = (ref: ResolvedRef) =>
    ref.sha ? `${refLabel(ref)} (${ref.sha.slice(0, 9)})` : refLabel(ref);
  console.log(chalk.cyan(`Files:   ${benchFiles.map((benchFile) => benchFile.file).join(', ')}`));
  console.log(chalk.cyan(`Refs:    ${refs.map(describeRef).join(', ')}`));
  console.log(chalk.cyan(`Browser: ${browserBinary} ${launchArgs.join(' ')}`));
  // Logical CPUs (hardware threads, vCPUs in CI), not physical cores; it honours CPU affinity, and
  // in practice a container's CPU quota.
  const cpus = os.availableParallelism();
  console.log(chalk.cyan(`CPUs:    ${cpus}`));
  if (cpus < MIN_CPUS) {
    console.warn(
      chalk.yellow(
        `Only ${cpus} logical CPUs are available; use at least ${MIN_CPUS}. With fewer, V8's background ` +
          'compilers are starved, so how fast the same code runs depends on how its compilation ' +
          'happened to go, which costs the results precision.',
      ),
    );
  }

  try {
    // Pack both sides at once: each builds in its own checkout, and nothing is measured yet.
    const packing = await Promise.allSettled(
      refs.map(async (ref) => {
        if (ref.variant === 'current') {
          return packWorkingTree({ repoRoot, outRoot: path.join(packedDir, 'current'), buildCmd });
        }
        // packRef caches a ref's tarballs by SHA; a hit skips the checkout, install, and build.
        return packRef({ repoRoot, ref: ref.sha, outRoot: packedDir, buildCmd });
      }),
    );
    // Settled both before failing: one side's failure must not cut the other's cleanup short, or a
    // checkout outlives the run.
    const packedByRef = packing.map((result) => {
      if (result.status === 'rejected') {
        throw result.reason;
      }
      return result.value;
    });

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
        outDir: path.join(buildsDir, ref.variant),
      });
    }

    const results = await runInterleaved({
      buildsDir,
      benchFiles,
      benchRefs: refs,
      browserBinary,
      launchArgs,
      sampling,
      testNamePattern: namePattern,
    });

    const { commitSha, branch } = await getCiMetadata();
    const report: BenchmarkRunReport = {
      version: 2,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      head: { sha: commitSha, branch },
      environment: {
        browser: `Chromium ${results.browserVersion}`,
        platform: process.platform,
        arch: process.arch,
        launchArgs,
      },
      builds: Object.fromEntries(
        refs.map((ref) => [ref.variant, { sha: ref.sha, label: refLabel(ref) }]),
      ),
      metrics: results.metrics,
      benchmarks: results.benchmarks,
    };

    const outPath = out ? path.resolve(out) : resultsPathOf(harnessDir);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    if (reporter === 'json') {
      // The only thing on stdout: everything else a run prints goes to stderr in this mode.
      process.stdout.write(`${JSON.stringify(summarizeRun(report), null, 2)}\n`);
    } else {
      console.log('');
      printRunReport(report);
    }
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

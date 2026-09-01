/* eslint-disable no-console */

import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { execaSync } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef, packWorkingTree } from '../utils/packWorkspace.mjs';
import { createRefResolver } from './refs.mjs';
import { discoverCases, pagesOf } from './discoverCases.mjs';
import { buildRefPages } from './buildPages.mjs';
import { assertDriverMatchesBrowser, resolveBrowserBinary } from './browser.mjs';
import { summarizeCase } from './summarizeCase.mjs';
import { renderTachometerReport } from './renderReport.mjs';
import { run } from './exec.mjs';

/**
 * @typedef {Object} RunTachometerOptions
 * @property {string} harnessDir - The harness package directory (where the command was run)
 * @property {string[]} [filters] - Only run cases whose folder name contains one of these substrings
 * @property {string} [baseline] - Binds the `baseline` symbol, in the ref grammar (e.g. `git:abc1234`)
 * @property {string} [baseBranch] - Branch PRs fork from. Defaults to detection via `origin/HEAD`
 * @property {string} [buildCmd] - Command that builds the publishable packages of a checked-out ref. Defaults to `pnpm release:build`
 * @property {string} [workingTreeBuildCmd] - Command that builds the working tree. Defaults to `buildCmd`
 * @property {boolean} [install] - Whether to install inside a ref's checkout. Defaults to true
 * @property {string} [out] - Where to write the combined JSON report. Defaults to `results/report.json`
 */

/**
 * Benchmarks the harness's pages across one or more builds of the workspace with tachometer, and
 * writes a combined JSON report.
 *
 * Cases are the source of truth: the selected `tachometer.json` files determine which pages to
 * build, one variant is built per distinct ref, each url is then rewritten to that ref's built page,
 * and each case runs as its own tachometer invocation so its result is a clean table for that
 * scenario rather than a grid comparing unrelated scenarios against each other.
 *
 * @param {RunTachometerOptions} options - What to run
 * @returns {Promise<void>}
 */
export async function runTachometer(options) {
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
  } = options;

  const repoRoot = await findWorkspaceDir(harnessDir);
  if (!repoRoot) {
    throw new Error(`Could not find a pnpm workspace root above ${harnessDir}.`);
  }

  const buildsDir = path.join(harnessDir, 'builds');
  // Everything reusable between runs lives under `.cache`. `packed` holds tarballs — a ref's keyed
  // by commit SHA, the working tree's by content hash — and is what CI should cache; `installs`
  // holds each ref's isolated install, cheap to recreate. Both are gitignored and safe to delete.
  const cacheDir = path.join(harnessDir, '.cache');
  const packedDir = path.join(cacheDir, 'packed');
  const installsDir = path.join(cacheDir, 'installs');

  const resolver = createRefResolver({ repoRoot, baseBranch, baselineOverride: baseline });
  const cases = await discoverCases({ harnessDir, filters, resolveRef: resolver.parse });

  /** @type {Map<string, import('./refs.mjs').ResolvedRef>} */
  const refs = new Map();
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
  const describeRef = (/** @type {import('./refs.mjs').ResolvedRef} */ ref) =>
    ref.sha ? `${ref.label} (${ref.sha.slice(0, 9)})` : ref.label;

  // Before any build: a driver that cannot open the browser fails the run either way, and finding
  // out now costs seconds instead of minutes of packing and installing.
  const browserBinary = await resolveBrowserBinary(harnessDir);
  assertDriverMatchesBrowser(harnessDir, browserBinary);

  console.log(chalk.cyan(`Cases:   ${cases.map((entry) => entry.name).join(', ')}`));
  console.log(chalk.cyan(`Pages:   ${pagesOf(cases).join(', ')}`));
  console.log(chalk.cyan(`Refs:    ${[...refs.values()].map(describeRef).join(', ')}`));
  console.log(chalk.cyan(`Browser: ${browserBinary}`));

  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'tacho-'));

  try {
    // Build one variant per distinct ref, every one through its own isolated install so both sides
    // of a comparison resolve the library identically.
    for (const ref of refs.values()) {
      const packages =
        ref.kind === 'worktree'
          ? // eslint-disable-next-line no-await-in-loop
            await packWorkingTree({
              repoRoot,
              outRoot: path.join(packedDir, 'current'),
              buildCmd: workingTreeBuildCmd,
            })
          : // packRef caches a ref's tarballs by SHA; a hit skips the checkout, install, and build.
            // eslint-disable-next-line no-await-in-loop
            await packRef({
              repoRoot,
              ref: /** @type {string} */ (ref.committish),
              outRoot: packedDir,
              // An empty install command means "skip"; otherwise packRef's default install runs.
              installCmd: install ? undefined : '',
              buildCmd,
            }).then((packed) => packed.packages);

      // eslint-disable-next-line no-await-in-loop
      await buildRefPages({
        harnessDir,
        repoRoot,
        ref,
        packages,
        workDir: path.join(installsDir, ref.id),
        outDir: path.join(buildsDir, ref.id),
      });
    }

    // Rewrite each leaf url to its ref's built page, then run each case's own config. Tachometer
    // resolves relative urls against the config file's directory and these configs are written to a
    // temp dir, so the rewritten urls are absolute.
    /** @type {Array<{ entry: import('./discoverCases.mjs').BenchmarkCase, json: any }>} */
    const results = [];
    for (const entry of cases) {
      for (const leaf of entry.leaves) {
        const refId = leaf.ref ? leaf.ref.id : 'current';
        leaf.node.url = `${path.join(buildsDir, refId, leaf.page)}${leaf.suffix}`;
      }
      // `browser` is inherited down the `expand` tree, so setting it per benchmark covers every
      // variant. An explicitly configured binary wins.
      for (const benchmark of entry.config.benchmarks ?? []) {
        benchmark.browser = {
          ...benchmark.browser,
          binary: benchmark.browser?.binary ?? browserBinary,
        };
      }
      const configPath = path.join(tmpBase, `tachometer-${entry.name}.json`);
      // eslint-disable-next-line no-await-in-loop
      await writeFile(
        configPath,
        `${JSON.stringify({ ...entry.config, root: harnessDir }, null, 2)}\n`,
      );

      console.log(chalk.cyan(`\nRunning "${entry.name}"…`));
      const jsonPath = path.join(tmpBase, `result-${entry.name}.json`);
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

    const outPath = out ? path.resolve(out) : path.join(harnessDir, 'results', 'report.json');
    const report = {
      // Consumers render reports from several benchmark axes; the pair identifies which one this
      // is and how to read it.
      version: 1,
      reportType: /** @type {const} */ ('tachometer'),
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
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}

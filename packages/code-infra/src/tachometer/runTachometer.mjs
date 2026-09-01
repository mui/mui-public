/* eslint-disable no-console */

import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { execaSync } from 'execa';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packRef } from '../utils/packWorkspace.mjs';
import { createRefResolver } from './refs.mjs';
import { discoverCases, pagesOf } from './discoverCases.mjs';
import { buildPackages, buildRefPages, buildWorkspacePages } from './buildPages.mjs';
import { summarizeCase } from './summarizeCase.mjs';
import { run } from './exec.mjs';

/**
 * @typedef {Object} RunTachometerOptions
 * @property {string} harnessDir - The harness package directory (where the command was run)
 * @property {string[]} [filters] - Only run cases whose folder name contains one of these substrings
 * @property {string} [baseline] - Binds the `baseline` symbol, in the ref grammar (e.g. `git:abc1234`)
 * @property {string} [baseBranch] - Branch PRs fork from. Defaults to detection via `origin/HEAD`
 * @property {string} [buildCmd] - Command that builds the publishable packages. Defaults to `pnpm release:build`
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
    install = true,
    out,
  } = options;

  const repoRoot = await findWorkspaceDir(harnessDir);
  if (!repoRoot) {
    throw new Error(`Could not find a pnpm workspace root above ${harnessDir}.`);
  }

  const buildsDir = path.join(harnessDir, 'builds');
  // Non-working-tree refs are packed into a folder keyed by their commit SHA and cached here, so
  // repeating a comparison against the same ref reuses the tarballs instead of rebuilding.
  const cacheDir = path.join(harnessDir, '.cache');

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

  console.log(chalk.cyan(`Cases:  ${cases.map((entry) => entry.name).join(', ')}`));
  console.log(chalk.cyan(`Pages:  ${pagesOf(cases).join(', ')}`));
  console.log(chalk.cyan(`Refs:   ${[...refs.values()].map(describeRef).join(', ')}`));

  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'tacho-'));

  try {
    for (const ref of refs.values()) {
      const outDir = path.join(buildsDir, ref.id);
      if (ref.kind === 'worktree') {
        // The working tree's build is in this workspace, so build it and let the workspace link
        // resolve it — no packing and no isolated install. This is also the fast dev loop.
        // eslint-disable-next-line no-await-in-loop
        await buildPackages(repoRoot, buildCmd, ref.label);
        // eslint-disable-next-line no-await-in-loop
        await buildWorkspacePages({ harnessDir, ref, outDir });
        continue;
      }

      // packRef packs every workspace package at the ref into a folder cached by SHA. On a cache hit
      // it skips the checkout, install, and build entirely; on a miss it builds in a throwaway
      // checkout and removes it as soon as the tarballs are packed.
      // eslint-disable-next-line no-await-in-loop
      const packed = await packRef({
        repoRoot,
        ref: /** @type {string} */ (ref.committish),
        outRoot: cacheDir,
        // An empty install command means "skip"; otherwise packRef's default install runs.
        installCmd: install ? undefined : '',
        buildCmd,
      });

      // eslint-disable-next-line no-await-in-loop
      await buildRefPages({
        harnessDir,
        repoRoot,
        ref,
        packages: packed.packages,
        workDir: path.join(tmpBase, `bench-${ref.id}`),
        outDir,
      });
    }

    // Rewrite each leaf url to its ref's built page, then run each case's own config. Tachometer
    // resolves relative urls against the config file's directory and these configs are written to a
    // temp dir, so the rewritten urls are absolute.
    /** @type {Array<{ name: string, json: import('./summarizeCase.mjs').TachometerJson }>} */
    const results = [];
    for (const entry of cases) {
      for (const leaf of entry.leaves) {
        const refId = leaf.ref ? leaf.ref.id : 'current';
        leaf.node.url = `${path.join(buildsDir, refId, leaf.page)}${leaf.suffix}`;
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
      results.push({ name: entry.name, json: JSON.parse(await readFile(jsonPath, 'utf8')) });
    }

    const outPath = out ? path.resolve(out) : path.join(harnessDir, 'results', 'report.json');
    const report = {
      generatedAt: new Date().toISOString(),
      head: {
        ref: 'HEAD',
        sha: execaSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim(),
      },
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
      cases: results.map(({ name, json }) => {
        try {
          return summarizeCase(name, json);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.yellow(`Could not summarize "${name}": ${message}`));
          return { name, error: message };
        }
      }),
      raw: Object.fromEntries(results.map(({ name, json }) => [name, json])),
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(chalk.green(`\nWrote JSON report to ${outPath}`));
    for (const entry of report.cases) {
      if (!('comparisons' in entry)) {
        console.log(`  ${entry.name}: no result (${entry.error})`);
        continue;
      }
      for (const comparison of entry.comparisons) {
        console.log(
          `  ${entry.name}: ${entry.reference} is ${comparison.verdict} vs ${comparison.variant}`,
        );
      }
    }
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}

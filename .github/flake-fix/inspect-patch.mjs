#!/usr/bin/env node
// Inspect the sandbox's proposed patch before the publish job applies it.
//
// This is the trust boundary: the patch comes from an unrestricted agent, and the publish job
// holds write credentials, so nothing here is taken on faith. We let `git apply --numstat` do the
// diff parsing (it handles renames and binary hunks correctly) and enforce policy on the paths and
// sizes it reports. A violation exits non-zero and the publish job refuses to open a PR.
//
// Usage: node inspect-patch.mjs <patch-file> [<repo-dir>]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_FILES = 25;
const MAX_LINES = 400;

class PatchRejected extends Error {}

// A rename shows in numstat as `{old => new}`, `pre{old => new}post`, or `old => new`; the
// destination is what actually lands, so that is what we check.
export function destinationPath(rawPath) {
  const arrow = rawPath.indexOf('=>');
  if (arrow === -1) {
    return rawPath.trim();
  }
  const braceOpen = rawPath.indexOf('{');
  const braceClose = rawPath.indexOf('}');
  if (braceOpen !== -1 && braceClose !== -1) {
    const prefix = rawPath.slice(0, braceOpen);
    const suffix = rawPath.slice(braceClose + 1);
    const inner = rawPath
      .slice(braceOpen + 1, braceClose)
      .split('=>')[1]
      .trim();
    return `${prefix}${inner}${suffix}`.replace(/\/\//g, '/').trim();
  }
  return rawPath.slice(arrow + 2).trim();
}

// Check the patch; throw PatchRejected with a reason, or return a one-line summary. Pure enough to
// unit-test: it shells out to git for parsing but makes no other side effects.
export function inspectPatch(patchFile, repoDir) {
  if (!fs.existsSync(patchFile) || fs.statSync(patchFile).size === 0) {
    // An empty patch is not a rejection — it just means the agent proposed no change.
    return 'patch is empty; nothing to apply';
  }

  let numstat;
  try {
    // core.quotePath=false: git prints raw UTF-8 paths instead of quoting non-ASCII, so a path
    // can't dodge the prefix checks below by arriving escaped.
    numstat = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'apply', '--numstat', '--', patchFile],
      {
        cwd: repoDir,
        encoding: 'utf8',
      },
    );
  } catch (error) {
    throw new PatchRejected(`git could not parse it (${error.message.split('\n')[0]})`);
  }

  const rows = numstat.split('\n').filter((line) => line.trim().length > 0);
  if (rows.length === 0) {
    return 'patch touches no files; nothing to apply';
  }
  if (rows.length > MAX_FILES) {
    throw new PatchRejected(
      `touches ${rows.length} files (limit ${MAX_FILES}) — a minimal fix should not`,
    );
  }

  let totalLines = 0;
  for (const row of rows) {
    const [added, deleted, ...pathParts] = row.split('\t');
    const target = destinationPath(pathParts.join('\t'));

    if (target.startsWith('/') || target.split('/').includes('..')) {
      throw new PatchRejected(`path escapes the repository: ${target}`);
    }
    if (target === '.git' || target.startsWith('.git/')) {
      throw new PatchRejected(`writes into .git: ${target}`);
    }
    // Block the files that define GitHub Actions CI — workflows and composite actions both run in
    // this repo's CI. This is policy (the agent may not change CI wiring), not a push limitation:
    // CI config and source stay allowed, because fixing those is the whole point. The real safety
    // is that a fix branch reaches no important secrets (see the workflow header), so this is a
    // backstop.
    if (target.startsWith('.github/workflows/') || target.startsWith('.github/actions/')) {
      throw new PatchRejected(
        `edits GitHub Actions CI, which this automation may not change: ${target}`,
      );
    }
    // Binary hunks report `-`/`-`; count them as one changed unit rather than skipping the cap.
    totalLines += (added === '-' ? 1 : Number(added)) + (deleted === '-' ? 1 : Number(deleted));
  }

  if (totalLines > MAX_LINES) {
    throw new PatchRejected(
      `changes ${totalLines} lines (limit ${MAX_LINES}) — too large for an automated minimal fix`,
    );
  }
  return `patch ok: ${rows.length} file(s), ${totalLines} line(s) changed`;
}

function main() {
  const patchFile = process.argv[2];
  const repoDir = process.argv[3] || process.cwd();
  if (!patchFile) {
    console.error('usage: node inspect-patch.mjs <patch-file> [<repo-dir>]');
    process.exit(2);
  }
  try {
    console.log(inspectPatch(patchFile, repoDir));
  } catch (error) {
    if (error instanceof PatchRejected) {
      console.error(`patch rejected: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

// Run the CLI only when invoked directly, so tests can import the functions above.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

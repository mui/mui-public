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

const MAX_FILES = 25;
const MAX_LINES = 400;

const patchFile = process.argv[2];
const repoDir = process.argv[3] || process.cwd();
if (!patchFile) {
  console.error('usage: node inspect-patch.mjs <patch-file> [<repo-dir>]');
  process.exit(2);
}

function fail(reason) {
  console.error(`patch rejected: ${reason}`);
  process.exit(1);
}

if (!fs.existsSync(patchFile) || fs.statSync(patchFile).size === 0) {
  // An empty patch is not a rejection — it just means the agent proposed no change.
  console.log('patch is empty; nothing to apply');
  process.exit(0);
}

let numstat;
try {
  numstat = execFileSync('git', ['apply', '--numstat', '--', patchFile], {
    cwd: repoDir,
    encoding: 'utf8',
  });
} catch (error) {
  fail(`git could not parse it (${error.message.split('\n')[0]})`);
}

// A rename shows as `{old => new}` or `old => new`; take the destination path, which is what lands.
function destinationPath(rawPath) {
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

const rows = numstat.split('\n').filter((line) => line.trim().length > 0);
if (rows.length === 0) {
  console.log('patch touches no files; nothing to apply');
  process.exit(0);
}
if (rows.length > MAX_FILES) {
  fail(`touches ${rows.length} files (limit ${MAX_FILES}) — a minimal fix should not`);
}

let totalLines = 0;
for (const row of rows) {
  const [added, deleted, ...pathParts] = row.split('\t');
  const rawPath = pathParts.join('\t');
  const target = destinationPath(rawPath);

  if (target.startsWith('/') || target.split('/').includes('..')) {
    fail(`path escapes the repository: ${target}`);
  }
  if (target === '.git' || target.startsWith('.git/')) {
    fail(`writes into .git: ${target}`);
  }
  if (target.startsWith('.github/workflows/')) {
    fail(`edits a workflow file, which a token cannot publish: ${target}`);
  }
  // Binary hunks report `-`/`-`; count them as one changed unit rather than skipping the cap.
  totalLines += (added === '-' ? 1 : Number(added)) + (deleted === '-' ? 1 : Number(deleted));
}

if (totalLines > MAX_LINES) {
  fail(`changes ${totalLines} lines (limit ${MAX_LINES}) — too large for an automated minimal fix`);
}

console.log(`patch ok: ${rows.length} file(s), ${totalLines} line(s) changed`);
process.exit(0);

#!/usr/bin/env node
/* eslint-disable no-console -- a CLI: its result goes to stdout, diagnostics to stderr */
// Sanity-check the agent's proposed patch before the publish job turns it into a commit.
//
// The patch may change any file: safety comes from where it runs (a fix branch's CI has no
// important secrets) and from a person reviewing the draft PR, not from restricting paths here. So
// this only confirms the patch is something git can parse and that it is small enough to be a
// plausible minimal fix rather than a runaway diff. A violation exits non-zero and publish opens
// no PR.
//
// Usage: node inspect-patch.mjs <patch-file> [<repo-dir>]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_FILES = 25;
const MAX_LINES = 400;

class PatchRejected extends Error {}

// Check the patch; throw PatchRejected with a reason, or return a one-line summary. Shells out to
// git for parsing but makes no other side effects, so it is straightforward to unit-test.
export function inspectPatch(patchFile, repoDir) {
  if (!fs.existsSync(patchFile) || fs.statSync(patchFile).size === 0) {
    // An empty patch is not a rejection — it just means the agent proposed no change.
    return 'patch is empty; nothing to apply';
  }

  let numstat;
  try {
    numstat = execFileSync('git', ['apply', '--numstat', '--', patchFile], {
      cwd: repoDir,
      encoding: 'utf8',
    });
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
    const [added, deleted] = row.split('\t');
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

// Run the CLI only when invoked directly, so tests can import the function above.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

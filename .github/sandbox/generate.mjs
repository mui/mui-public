#!/usr/bin/env node
// Sync the base64 payload blobs in the workflow with the canonical files in this directory.
//
// The workflow inlines fetch.mjs / proxy.mjs / bootstrap.sh / prompt.md / inspect-patch.mjs as
// base64 so a caller pinning the workflow by SHA gets the exact code that runs. This script is the
// single writer of those blobs: it finds each `base64 -d <<< '<blob>' > "…/sandbox/<name>"` line
// and replaces <blob> with the current base64 of <name>.
//
//   node generate.mjs           # rewrite the workflow in place
//   node generate.mjs --check    # exit 1 if the workflow is out of sync (for CI)

import fs from 'node:fs';

const WORKFLOW = new URL('../workflows/claude-flake-fix.yml', import.meta.url).pathname;
const HERE = new URL('.', import.meta.url).pathname;
const check = process.argv.includes('--check');

// Match the payload lines and capture the current blob and the destination file name.
const LINE_RE = /(base64 -d <<< ')([^']*)(' > "\$RUNNER_TEMP\/sandbox\/)([^"]+)(")/g;

const original = fs.readFileSync(WORKFLOW, 'utf8');
const seen = new Set();
const updated = original.replace(LINE_RE, (match, open, _oldBlob, mid, name, close) => {
  const canonical = `${HERE}${name}`;
  if (!fs.existsSync(canonical)) {
    throw new Error(`workflow references ${name}, but ${canonical} does not exist`);
  }
  seen.add(name);
  const blob = fs.readFileSync(canonical).toString('base64');
  return `${open}${blob}${mid}${name}${close}`;
});

if (seen.size === 0) {
  throw new Error('no payload lines found in the workflow — did the inline format change?');
}

if (check) {
  if (updated !== original) {
    console.error(
      `workflow is out of sync with .github/sandbox/ (${[...seen].join(', ')}).\n` +
        'Run `node .github/sandbox/generate.mjs` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`payload blobs in sync (${seen.size} files)`);
} else {
  fs.writeFileSync(WORKFLOW, updated);
  console.log(`synced ${seen.size} payload blobs: ${[...seen].join(', ')}`);
}

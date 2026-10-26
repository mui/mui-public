#!/usr/bin/env node
// Collects the fingerprints that existing flake-fix PRs already cover, so the classifier can mark
// them not-fixable and the agent moves on to the next problem instead of re-proposing a fix that is
// already open or merged.
//
// Each flake-fix PR records what it resolves in its body, written there by the publish job:
//   <!-- flake-fix:resolves
//   <fingerprint>
//   ...
//   -->
// Given a `gh pr list --json number,url,state,mergedAt,body` dump, this returns one entry per
// covered fingerprint with the covering PR and its state — enough for classify to decide whether the
// coverage still holds (an open PR always counts; a merged one only until the failures outlast it).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// The resolves marker: everything between the opening comment and its close, one fingerprint a line.
const MARKER = /<!--\s*flake-fix:resolves\s*\n([\s\S]*?)\n\s*-->/;

function resolvesOf(body) {
  const match = MARKER.exec(body ?? '');
  if (!match) {
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// pulls: [{ number, url, state, mergedAt, body }] as `gh pr list --json ...` emits them. gh reports
// state as OPEN | CLOSED | MERGED. A closed-but-unmerged PR's fix was rejected, so it covers nothing.
export function covered(pulls) {
  const entries = [];
  for (const pull of pulls ?? []) {
    const open = pull.state === 'OPEN';
    const merged = pull.state === 'MERGED' || Boolean(pull.mergedAt);
    if (!open && !merged) {
      continue;
    }
    for (const fingerprint of resolvesOf(pull.body)) {
      entries.push({
        fingerprint,
        state: open ? 'OPEN' : 'MERGED',
        mergedAt: open ? null : (pull.mergedAt ?? null),
        pr: pull.url || (pull.number != null ? `#${pull.number}` : ''),
      });
    }
  }
  return entries;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [pullsPath, outPath] = process.argv.slice(2);
  if (!pullsPath || !outPath) {
    process.stderr.write('usage: prior-fixes.mjs <pulls.json> <out.json>\n');
    process.exit(2);
  }
  const pulls = JSON.parse(fs.readFileSync(pullsPath, 'utf8'));
  fs.writeFileSync(outPath, `${JSON.stringify(covered(pulls), null, 2)}\n`);
  process.stderr.write(`wrote ${outPath}\n`);
}

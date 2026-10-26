#!/usr/bin/env node
// Narrows a `gh pr list` dump of this repo's flake-fix PRs to the ones still worth showing the
// triage agent, so it can see what's already in hand and not re-propose the same fix.
//
// Kept: open PRs (a fix in flight) and PRs merged in the last 24h — a just-merged fix keeps showing
// in the failure data until CI next runs, and that gap is exactly when the agent would waste its one
// slot re-fixing it. A closed-but-unmerged PR (rejected fix) and older merges are dropped: the
// former covers nothing, the latter have had time for CI to catch up (the flake reads as FIXED by
// then). The agent judges overlap from each PR's own title and body — no fingerprint matching, which
// the agent doesn't regenerate identically run to run.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;

// pulls: [{ number, url, title, state, mergedAt, body }] as `gh pr list --json ...` emits them. gh
// reports state as OPEN | CLOSED | MERGED.
export function recentFixPulls(pulls, now = new Date()) {
  const cutoff = now.getTime() - DAY_MS;
  return (pulls ?? [])
    .filter((pull) => {
      if (pull.state === 'OPEN') {
        return true;
      }
      const merged = pull.state === 'MERGED' || Boolean(pull.mergedAt);
      return merged && pull.mergedAt && new Date(pull.mergedAt).getTime() >= cutoff;
    })
    .map((pull) => ({
      number: pull.number,
      url: pull.url,
      title: pull.title,
      state: pull.state,
      mergedAt: pull.mergedAt ?? null,
      body: pull.body ?? '',
    }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [pullsPath, outPath] = process.argv.slice(2);
  if (!pullsPath || !outPath) {
    process.stderr.write('usage: prior-fixes.mjs <pulls.json> <out.json>\n');
    process.exit(2);
  }
  const pulls = JSON.parse(fs.readFileSync(pullsPath, 'utf8'));
  fs.writeFileSync(outPath, `${JSON.stringify(recentFixPulls(pulls), null, 2)}\n`);
  process.stderr.write(`wrote ${outPath}\n`);
}

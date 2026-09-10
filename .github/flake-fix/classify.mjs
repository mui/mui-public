#!/usr/bin/env node
// Deterministic issue classifier for the flake-fix agent.
//
// The agent does the fuzzy part: it reads each failed run's log, groups the failures by their error
// (a "fingerprint"), and tags any that are a named outside service being down. Given the timeline
// (every run of each failing job, pass/fail, newest first) and those fingerprints, the class of
// each fingerprint follows from where its failures sit among the passes:
//
//   STRUCTURAL — still failing: no PASS at or after its most recent failure.
//   FLAKY      — a PASS sits between two of its failures.
//   FIXED      — its failures are one unbroken run with a PASS after the last one.
//   EXTERNAL   — the agent tagged it as an outside service; this wins over the shape.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// A fingerprint's class depends only on its own failures and the PASS runs around them. Any other
// run — a different error, a skip, or a failure whose log was not downloaded — is no evidence
// either way.
export function classify(timeline, fingerprints) {
  const groupByLog = new Map();
  for (const group of fingerprints.groups ?? []) {
    for (const log of group.logs ?? []) {
      groupByLog.set(log, group);
    }
  }

  const verdicts = [];
  for (const job of timeline.jobs ?? []) {
    const runs = job.runs ?? []; // newest first
    const greens = [...runs.keys()].filter((index) => runs[index].result === 'PASS');
    const evidence = (position) => {
      const run = runs[position];
      return { time: run.time, pipeline: run.pipeline, commit: run.commit, url: run.url };
    };

    // Group each failed run's position under its fingerprint in one newest-first pass, so the first
    // position recorded for a fingerprint is its most recent failure.
    const byFingerprint = new Map(); // fingerprint -> { group, positions: number[] (newest first) }
    runs.forEach((run, position) => {
      const group = run.log ? groupByLog.get(run.log) : undefined;
      if (!group) {
        return;
      }
      const entry = byFingerprint.get(group.fingerprint) ?? { group, positions: [] };
      entry.positions.push(position);
      byFingerprint.set(group.fingerprint, entry);
    });

    for (const [fingerprint, { group, positions }] of byFingerprint) {
      const newestFailure = positions[0];
      const oldestFailure = positions.at(-1);

      let klass;
      if (group.external) {
        klass = 'EXTERNAL';
      } else if (greens.some((green) => green > newestFailure && green < oldestFailure)) {
        klass = 'FLAKY';
      } else if (greens.some((green) => green < newestFailure)) {
        klass = 'FIXED';
      } else {
        klass = 'STRUCTURAL';
      }

      verdicts.push({
        fingerprint,
        job: job.job,
        workflow: job.workflow,
        class: klass,
        fixable: klass === 'STRUCTURAL' || klass === 'FLAKY',
        failureCount: positions.length,
        firstSeen: evidence(oldestFailure),
        lastSeen: { ...evidence(newestFailure), log: runs[newestFailure].log },
      });
    }
  }

  // Fixable first, structural ahead of flaky, then the most failures — so the agent's fix target is
  // at the top.
  const rank = { STRUCTURAL: 0, FLAKY: 1, FIXED: 2, EXTERNAL: 3 };
  verdicts.sort(
    (left, right) => rank[left.class] - rank[right.class] || right.failureCount - left.failureCount,
  );
  return { verdicts };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [timelinePath, fingerprintsPath, outPath] = process.argv.slice(2);
  if (!timelinePath || !fingerprintsPath || !outPath) {
    process.stderr.write('usage: classify.mjs <timeline.json> <fingerprints.json> <out.json>\n');
    process.exit(2);
  }
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
  fs.writeFileSync(outPath, `${JSON.stringify(classify(timeline, fingerprints), null, 2)}\n`);
  process.stderr.write(`wrote ${outPath}\n`);
}

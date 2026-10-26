#!/usr/bin/env node
// Deterministic issue classifier for the flake-fix agent.
//
// The agent does the fuzzy part: it reads each failed run's log, groups the failures by their error
// (a "fingerprint"), and tags any that are a named outside service being down. Given the timeline
// (every run of each failing job, pass/fail, newest first) and those fingerprints, the class of
// each fingerprint follows from where its failures sit among the passes:
//
//   STRUCTURAL  — failed more than once with no pass since: a real, ongoing streak.
//   UNCONFIRMED — a single failure with no pass since: too little to tell a real break from a
//                 one-off, so worth a cautious look but not a confident bug.
//   FLAKY       — a PASS sits between two of its failures.
//   FIXED       — its failures are one unbroken run with a PASS after the last one.
//   EXTERNAL    — the agent tagged it as an outside service; this wins over the shape.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// A fingerprint's class depends only on its own failures and the PASS runs around them. Any other
// run — a different error, a skip, or a failure whose log was not downloaded — is no evidence
// either way.
//
// `covered` (from prior-fixes.mjs) lists fingerprints an open or merged fix PR already handles. A
// verdict whose fingerprint is still covered is marked not fixable and carries `coveredBy`, so the
// agent shows it as in hand and moves on to the next problem instead of re-proposing the same fix.
export function classify(timeline, fingerprints, covered = []) {
  // fingerprint -> the PRs that say they resolve it; the newest-first verdict loop consults this.
  const coveredByFingerprint = new Map();
  for (const entry of covered) {
    const entries = coveredByFingerprint.get(entry.fingerprint) ?? [];
    entries.push(entry);
    coveredByFingerprint.set(entry.fingerprint, entries);
  }

  // A single failure log can show more than one distinct error, so a log maps to every group that
  // claims it — not just one, or an overlapping error's occurrence would be lost.
  const groupsByLog = new Map();
  for (const group of fingerprints.groups ?? []) {
    for (const log of group.logs ?? []) {
      const groupsForLog = groupsByLog.get(log) ?? [];
      groupsForLog.push(group);
      groupsByLog.set(log, groupsForLog);
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
      const groupsForLog = run.log ? groupsByLog.get(run.log) : undefined;
      for (const group of groupsForLog ?? []) {
        const entry = byFingerprint.get(group.fingerprint) ?? { group, positions: [] };
        entry.positions.push(position);
        byFingerprint.set(group.fingerprint, entry);
      }
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
      } else if (positions.length === 1) {
        // One failure, no pass since — could be a real break or a one-off; not enough to be sure.
        klass = 'UNCONFIRMED';
      } else {
        klass = 'STRUCTURAL';
      }

      const firstSeen = evidence(oldestFailure);
      // An open fix PR always counts; a merged one only while the fix is newer than the oldest
      // failure we still see — once failures outlast the merge, the fix didn't hold and the problem
      // is live again, so it stops being covered and the agent may re-engage.
      const coverage = (coveredByFingerprint.get(fingerprint) ?? []).find(
        (entry) =>
          entry.state === 'OPEN' ||
          (entry.mergedAt && new Date(entry.mergedAt) >= new Date(firstSeen.time)),
      );

      verdicts.push({
        fingerprint,
        job: job.job,
        workflow: job.workflow,
        class: klass,
        // Everything but a clean recovery or an outside service is worth attempting a fix — unless a
        // fix PR already covers it.
        fixable: klass !== 'FIXED' && klass !== 'EXTERNAL' && !coverage,
        ...(coverage ? { coveredBy: coverage.pr } : {}),
        failureCount: positions.length,
        firstSeen,
        lastSeen: { ...evidence(newestFailure), log: runs[newestFailure].log },
      });
    }
  }

  // Fixable first, structural ahead of flaky, then the most failures — so the agent's fix target is
  // at the top.
  const rank = { STRUCTURAL: 0, FLAKY: 1, UNCONFIRMED: 2, FIXED: 3, EXTERNAL: 4 };
  verdicts.sort(
    (left, right) => rank[left.class] - rank[right.class] || right.failureCount - left.failureCount,
  );
  return { verdicts };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [timelinePath, fingerprintsPath, outPath, coveredPath] = process.argv.slice(2);
  if (!timelinePath || !fingerprintsPath || !outPath) {
    process.stderr.write(
      'usage: classify.mjs <timeline.json> <fingerprints.json> <out.json> [covered.json]\n',
    );
    process.exit(2);
  }
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
  // Optional: absent or unreadable means no prior fix PRs are known — classify as if none.
  let covered = [];
  if (coveredPath && fs.existsSync(coveredPath)) {
    covered = JSON.parse(fs.readFileSync(coveredPath, 'utf8'));
  }
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(classify(timeline, fingerprints, covered), null, 2)}\n`,
  );
  process.stderr.write(`wrote ${outPath}\n`);
}

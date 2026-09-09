#!/usr/bin/env node
// Deterministic issue classifier for the flake-fix agent.
//
// The agent does the fuzzy part — reading each failed run's log and grouping the failures by their
// error (a "fingerprint"), tagging any that are a named outside service being down. This turns that
// into a verdict: given the timeline (every run of each failing job, pass/fail, newest first) and
// those fingerprints, the CLASS of each fingerprint is pure arithmetic over the run order:
//
//   STRUCTURAL — still failing: no PASS at or after the fingerprint's most recent failure.
//   FLAKY      — a PASS sits between two of its failures.
//   FIXED      — its failures are one unbroken streak and a PASS follows the last one.
//   EXTERNAL   — the agent tagged it as an outside service (short-circuits the shape).
//
// Kept out of fetch.mjs on purpose: fetch runs before any log is read, so it has no fingerprints;
// the agent calls this after it has produced them. Reads the timeline and fingerprints, writes the
// verdict to a new JSON file the agent then builds its report and PR from.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Only PASS is a positive signal for a fingerprint. A run that failed with a DIFFERENT error, was
// skipped, or whose log we did not download (capped) is no evidence either way — it neither breaks
// a still-broken streak nor proves recovery, so the shape rules look only at this fingerprint's own
// failures and at PASS runs.
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
    // Which fingerprint (if known) each run carries, by position.
    const fingerprintAt = runs.map((run) =>
      run.log ? groupByLog.get(run.log)?.fingerprint : undefined,
    );
    const greenIndexes = runs
      .map((run, index) => (run.result === 'PASS' ? index : -1))
      .filter((index) => index >= 0);

    const seen = new Set();
    for (let index = 0; index < runs.length; index += 1) {
      const fingerprint = fingerprintAt[index];
      if (!fingerprint || seen.has(fingerprint)) {
        continue;
      }
      seen.add(fingerprint);
      const group = groupByLog.get(runs[index].log);
      const occurrences = runs
        .map((run, position) => position)
        .filter((position) => fingerprintAt[position] === fingerprint);
      const newestFailure = Math.min(...occurrences); // smallest index = most recent
      const oldestFailure = Math.max(...occurrences);

      let klass;
      if (group?.external) {
        klass = 'EXTERNAL';
      } else if (greenIndexes.some((green) => green > newestFailure && green < oldestFailure)) {
        klass = 'FLAKY';
      } else if (greenIndexes.some((green) => green < newestFailure)) {
        klass = 'FIXED';
      } else {
        klass = 'STRUCTURAL';
      }

      const lastSeen = runs[newestFailure];
      const firstSeen = runs[oldestFailure];
      verdicts.push({
        fingerprint,
        job: job.job,
        workflow: job.workflow,
        external: Boolean(group?.external),
        class: klass,
        fixable: klass === 'STRUCTURAL' || klass === 'FLAKY',
        failureCount: occurrences.length,
        mostRecentRun: runs[0]?.result ?? null,
        firstSeen: { time: firstSeen.time, pipeline: firstSeen.pipeline, url: firstSeen.url },
        lastSeen: {
          time: lastSeen.time,
          pipeline: lastSeen.pipeline,
          url: lastSeen.url,
          log: lastSeen.log,
        },
      });
    }
  }

  // Fixable first, structural ahead of flaky, then the most failures — so the agent's fix target is
  // at the top.
  const rank = { STRUCTURAL: 0, FLAKY: 1, FIXED: 2, EXTERNAL: 3 };
  verdicts.sort(
    (left, right) => rank[left.class] - rank[right.class] || right.failureCount - left.failureCount,
  );
  return { fingerprints: verdicts };
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

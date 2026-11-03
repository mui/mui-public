#!/usr/bin/env node
// Issue classifier for the flake-fix agent.
//
// The agent does the fuzzy part: it reads each failed run's log, groups the failures by their error
// (a "fingerprint"), and tags any that are a named outside service being down. Given the timeline
// (every run of each failing job, pass/fail, newest first) and those fingerprints, this settles
// what the shape of the timeline can prove:
//
//   STRUCTURAL  — failed more than once with no pass since: a real, ongoing streak.
//   UNCONFIRMED — a single failure with no pass since: too little to tell a real break from a
//                 one-off, so worth a cautious look but not a confident bug.
//   FLAKY       — a PASS sits between two of its failures.
//   RECOVERED   — its failures are one unbroken run with a PASS after the last one.
//   EXTERNAL    — the agent tagged it as an outside service; this wins over the shape.
//
// What the shape can't prove is whether a recovery was a fix. Master runs once per commit, so one
// failure followed by passes looks the same whether the next commit fixed it or the test is a
// low-rate flake that didn't fire again. Only the commits between the last failure and the first
// pass can tell, so that is the agent's call: it names the fixing commit as `fixedBy` on the
// fingerprint group, and a RECOVERED issue becomes FIXED only when git confirms that commit lies in
// that range. Without one it stays RECOVERED — no claim that anything was fixed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

function git(repoDir, args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function resolveCommit(repoDir, ref) {
  try {
    return git(repoDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

function isAncestor(repoDir, ancestor, descendant) {
  try {
    git(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

// The claimed fix must be reachable from the first passing commit and not from the last failing
// one: (lastFailure, firstPass]. Every commit has to be in the local history, so a shallow clone
// that stops short of the range rejects the claim rather than guessing.
function checkFix(repoDir, claimed, recovery) {
  const sha = resolveCommit(repoDir, claimed);
  const lastFailure = recovery.lastFailure.sha && resolveCommit(repoDir, recovery.lastFailure.sha);
  const firstPass = recovery.firstPass.sha && resolveCommit(repoDir, recovery.firstPass.sha);
  if (!sha) {
    return { accepted: false, reason: `${claimed} is not a commit in this checkout` };
  }
  if (!lastFailure || !firstPass) {
    return { accepted: false, reason: 'the recovery range is not in this checkout' };
  }
  if (!isAncestor(repoDir, sha, firstPass) || isAncestor(repoDir, sha, lastFailure)) {
    return {
      accepted: false,
      reason: `${claimed} is not in ${recovery.lastFailure.sha}..${recovery.firstPass.sha}`,
    };
  }
  return { accepted: true, sha };
}

// A fingerprint's class depends only on its own failures and the PASS runs around them. Any other
// run — a different error, a skip, or a failure whose log was not downloaded — is no evidence
// either way. `repoDir` is the git checkout a claimed fix is checked against.
export function classify(timeline, fingerprints, { repoDir = process.cwd() } = {}) {
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
      return {
        time: run.time,
        pipeline: run.pipeline,
        commit: run.commit,
        sha: run.sha ?? null,
        url: run.url,
      };
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
      // Newest first, so the first pass after the newest failure is the highest index below it.
      const firstPass = greens.findLast((green) => green < newestFailure);

      let klass;
      let recovery;
      let fix;
      if (group.external) {
        klass = 'EXTERNAL';
      } else if (greens.some((green) => green > newestFailure && green < oldestFailure)) {
        klass = 'FLAKY';
      } else if (firstPass !== undefined) {
        klass = 'RECOVERED';
        recovery = { lastFailure: evidence(newestFailure), firstPass: evidence(firstPass) };
        if (group.fixedBy) {
          fix = checkFix(repoDir, group.fixedBy, recovery);
          if (fix.accepted) {
            klass = 'FIXED';
          } else {
            process.stderr.write(`${fingerprint}: fixedBy rejected — ${fix.reason}\n`);
          }
        }
      } else if (positions.length === 1) {
        // One failure, no pass since — could be a real break or a one-off; not enough to be sure.
        klass = 'UNCONFIRMED';
      } else {
        klass = 'STRUCTURAL';
      }

      verdicts.push({
        fingerprint,
        job: job.job,
        workflow: job.workflow,
        class: klass,
        // A recovery or an outside service has nothing left to fix; everything else is worth a try.
        fixable: !['RECOVERED', 'FIXED', 'EXTERNAL'].includes(klass),
        failureCount: positions.length,
        firstSeen: evidence(oldestFailure),
        lastSeen: { ...evidence(newestFailure), log: runs[newestFailure].log },
        ...(recovery && { recovery }),
        ...(fix?.accepted && { fixedBy: fix.sha }),
        ...(fix &&
          !fix.accepted && { rejectedFix: { claimed: group.fixedBy, reason: fix.reason } }),
      });
    }
  }

  // Fixable first, structural ahead of flaky, then the most failures — so the agent's fix target is
  // at the top.
  const rank = { STRUCTURAL: 0, FLAKY: 1, UNCONFIRMED: 2, RECOVERED: 3, FIXED: 4, EXTERNAL: 5 };
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

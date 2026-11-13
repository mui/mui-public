// Unit test for the issue classifier. These build small histories and check the class each shape
// yields; a claimed fix is checked against a real throwaway git repo.
//
// Run: pnpm test (this is a vitest project; see vitest.config.mts).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { classify } from './classify.mjs';

// Runs are newest first. A FAIL carries a log path; PASS/SKIP carry none.
const fail = (pipeline, log) => ({
  result: 'FAIL',
  time: `t${pipeline}`,
  pipeline,
  commit: `c${pipeline}`,
  url: `u${pipeline}`,
  log,
});
const pass = (pipeline) => ({
  result: 'PASS',
  time: `t${pipeline}`,
  pipeline,
  commit: `c${pipeline}`,
  url: `u${pipeline}`,
  log: null,
});

const timelineOf = (runs) => ({ jobs: [{ job: 'unit', workflow: 'test', runs }] });
const fingerprintsOf = (logs, external = false) => ({
  groups: [{ fingerprint: 'boom', external, logs }],
});

const classOf = (runs, fingerprints) => classify(timelineOf(runs), fingerprints).verdicts[0]?.class;

describe('classify', () => {
  it('RECOVERED: failures then a recovery (the mui-x false-positive shape)', () => {
    const runs = [pass(102), fail(101, 'jobs/0000.txt'), fail(100, 'jobs/0001.txt')];
    const verdict = classify(timelineOf(runs), fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt']))
      .verdicts[0];
    expect(verdict.class).toBe('RECOVERED');
    expect(verdict.fixable).toBe(false);
    expect(verdict.lastSeen.pipeline).toBe(101);
    expect(verdict.firstPass.pipeline).toBe(102);
    expect(verdict.failureCount).toBe(2);
    expect(verdict.lastSeen.pipeline).toBe(101); // newest failure
    expect(verdict.lastSeen.commit).toBe('c101'); // evidence carries the commit
    expect(verdict.firstSeen.pipeline).toBe(100);
  });

  it('RECOVERED, not FIXED: a single failure between passes says nothing about a fix', () => {
    // The shape a low-rate flake leaves on master, where each commit runs once.
    const runs = [pass(104), pass(103), fail(102, 'jobs/0000.txt'), pass(101)];
    const verdict = classify(timelineOf(runs), fingerprintsOf(['jobs/0000.txt'])).verdicts[0];
    expect(verdict.class).toBe('RECOVERED');
    expect(verdict.fixedBy).toBeUndefined();
    // The fix range ends at the first pass after the failure, not the newest one.
    expect(verdict.firstPass.pipeline).toBe(103);
  });

  it('STRUCTURAL: more than one failure, no recovery since', () => {
    const runs = [
      fail(103, 'jobs/0000.txt'),
      fail(102, 'jobs/0001.txt'),
      fail(101, 'jobs/0002.txt'),
    ];
    expect(classOf(runs, fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt', 'jobs/0002.txt']))).toBe(
      'STRUCTURAL',
    );
  });

  it('UNCONFIRMED: a single failure with no recovery — still worth attempting (fixable)', () => {
    const runs = [fail(103, 'jobs/0000.txt')];
    const verdict = classify(timelineOf(runs), fingerprintsOf(['jobs/0000.txt'])).verdicts[0];
    expect(verdict.class).toBe('UNCONFIRMED');
    expect(verdict.fixable).toBe(true);
  });

  it('FLAKY: a PASS sits between two failures', () => {
    const runs = [fail(104, 'jobs/0000.txt'), pass(103), fail(102, 'jobs/0001.txt')];
    expect(classOf(runs, fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt']))).toBe('FLAKY');
  });

  it('EXTERNAL: the agent tag wins over the shape', () => {
    const runs = [fail(103, 'jobs/0000.txt'), fail(102, 'jobs/0001.txt')];
    expect(classOf(runs, fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt'], true))).toBe(
      'EXTERNAL',
    );
  });

  it('a run failing with a DIFFERENT error does not break the streak or prove recovery', () => {
    // Newest run is a different, unfingerprinted failure; between/before are our failures, no PASS.
    const runs = [
      fail(103, 'jobs/other.txt'),
      fail(102, 'jobs/0000.txt'),
      fail(101, 'jobs/0001.txt'),
    ];
    expect(classOf(runs, fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt']))).toBe('STRUCTURAL');
  });

  it('a log matching two errors counts for both — the overlapping error is not dropped', () => {
    // Newest run's log shows errors A and B; a PASS sits between it and an older A-only failure.
    // A is still failing in the newest run, so it must stay fixable — not look FIXED just because B
    // shared its newest log.
    const runs = [fail(104, 'jobs/0000.txt'), pass(103), fail(102, 'jobs/0002.txt')];
    const fingerprints = {
      groups: [
        { fingerprint: 'A', external: false, logs: ['jobs/0000.txt', 'jobs/0002.txt'] },
        { fingerprint: 'B', external: false, logs: ['jobs/0000.txt'] },
      ],
    };
    const { verdicts } = classify(timelineOf(runs), fingerprints);
    const a = verdicts.find((verdict) => verdict.fingerprint === 'A');
    expect(a.class).toBe('FLAKY');
    expect(a.fixable).toBe(true);
    // B, which shares A's newest log, is still classified in its own right.
    expect(verdicts.find((verdict) => verdict.fingerprint === 'B')).toBeDefined();
  });

  it('orders the verdict so a fixable issue leads', () => {
    const timeline = {
      jobs: [
        { job: 'a', workflow: 'w', runs: [pass(200), fail(199, 'jobs/0000.txt')] }, // RECOVERED
        { job: 'b', workflow: 'w', runs: [fail(202, 'jobs/0001.txt'), fail(201, 'jobs/0002.txt')] }, // STRUCTURAL
      ],
    };
    const fingerprints = {
      groups: [
        { fingerprint: 'gone', external: false, logs: ['jobs/0000.txt'] },
        { fingerprint: 'live', external: false, logs: ['jobs/0001.txt', 'jobs/0002.txt'] },
      ],
    };
    const { verdicts } = classify(timeline, fingerprints);
    expect(verdicts[0].class).toBe('STRUCTURAL');
    expect(verdicts[0].fixable).toBe(true);
  });

  describe('a claimed fix', () => {
    // History: c1 passes, c2 fails, c3 changes the test, c4 passes.
    let repoDir;
    const shas = {};
    const commit = (name) => {
      fs.writeFileSync(path.join(repoDir, `${name}.txt`), name);
      execFileSync('git', ['add', '.'], { cwd: repoDir });
      execFileSync('git', ['commit', '-qm', name], { cwd: repoDir });
      shas[name] = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoDir,
        encoding: 'utf8',
      }).trim();
    };

    beforeAll(() => {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-'));
      execFileSync('git', ['init', '-q'], { cwd: repoDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoDir });
      ['c1', 'c2', 'c3', 'c4'].forEach(commit);
    });

    afterAll(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    const withSha = (run, sha) => ({ ...run, sha });
    const claim = (fixedBy, { lastFailure = shas.c2 } = {}) => {
      const runs = [
        withSha(pass(104), shas.c4),
        withSha(fail(102, 'jobs/0000.txt'), lastFailure),
        withSha(pass(101), shas.c1),
      ];
      const fingerprints = { groups: [{ fingerprint: 'boom', logs: ['jobs/0000.txt'], fixedBy }] };
      return classify(timelineOf(runs), fingerprints, { repoDir }).verdicts[0];
    };

    it('FIXED when the commit sits between the last failure and the first pass', () => {
      const verdict = claim(shas.c3.slice(0, 10));
      expect(verdict.class).toBe('FIXED');
      expect(verdict.fixable).toBe(false);
      expect(verdict.fixedBy).toBe(shas.c3);
    });

    it('accepts the first passing commit itself as the fix', () => {
      expect(claim(shas.c4).class).toBe('FIXED');
    });

    it('stays RECOVERED when the commit is the failing one or older', () => {
      for (const sha of [shas.c2, shas.c1]) {
        const verdict = claim(sha);
        expect(verdict.class).toBe('RECOVERED');
        expect(verdict.fixedBy).toBeUndefined();
        expect(verdict.rejectedFix).toContain(sha);
      }
    });

    it('stays RECOVERED when the commit is not in the checkout', () => {
      expect(claim('0123456789abcdef0123456789abcdef01234567').class).toBe('RECOVERED');
    });

    it('stays RECOVERED when the range reaches past the checkout', () => {
      // A shallow clone that stops short of the failing commit can't rule the claim out.
      const verdict = claim(shas.c3, { lastFailure: '0123456789abcdef0123456789abcdef01234567' });
      expect(verdict.class).toBe('RECOVERED');
      expect(verdict.rejectedFix).toMatch(/not in this checkout/);
    });

    it('is ignored on an issue that has not recovered', () => {
      const runs = [withSha(fail(102, 'jobs/0000.txt'), shas.c2)];
      const fingerprints = {
        groups: [{ fingerprint: 'boom', logs: ['jobs/0000.txt'], fixedBy: shas.c3 }],
      };
      expect(classify(timelineOf(runs), fingerprints, { repoDir }).verdicts[0].class).toBe(
        'UNCONFIRMED',
      );
    });
  });
});

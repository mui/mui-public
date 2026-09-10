// Unit test for the deterministic issue classifier. The classifier is pure (timeline +
// fingerprints -> verdict), so these build small histories and check the class each shape yields.
//
// Run: pnpm test (this is a vitest project; see vitest.config.mts).

import { describe, it, expect } from 'vitest';
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
  it('FIXED: failures then a recovery (the mui-x false-positive shape)', () => {
    const runs = [pass(102), fail(101, 'jobs/0000.txt'), fail(100, 'jobs/0001.txt')];
    const verdict = classify(timelineOf(runs), fingerprintsOf(['jobs/0000.txt', 'jobs/0001.txt']))
      .verdicts[0];
    expect(verdict.class).toBe('FIXED');
    expect(verdict.fixable).toBe(false);
    expect(verdict.failureCount).toBe(2);
    expect(verdict.lastSeen.pipeline).toBe(101); // newest failure
    expect(verdict.lastSeen.commit).toBe('c101'); // evidence carries the commit
    expect(verdict.firstSeen.pipeline).toBe(100);
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

  it('orders the verdict so a fixable issue leads', () => {
    const timeline = {
      jobs: [
        { job: 'a', workflow: 'w', runs: [pass(200), fail(199, 'jobs/0000.txt')] }, // FIXED
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
});

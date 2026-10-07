import { describe, expect, it } from 'vitest';
import {
  isTimeline,
  parseTimelineKeys,
  planUpload,
  timelinePointerKey,
  timelinePrefix,
  uploadTimeSchema,
} from './timeline';

const REPO = 'mui/material-ui';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TIME = 1_759_000_000_000;

function plan(trackedBranch: string | null, requested?: string) {
  return planUpload({
    repo: REPO,
    sha: SHA_A,
    reportType: 'benchmark',
    trackedBranch,
    requested,
    time: TIME,
  });
}

describe('planUpload', () => {
  it("puts a tracked branch's upload in the branch's timeline, as a base-branch report", () => {
    expect(plan('master')).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark.json`,
      timeline: 'master',
      pointerKey: timelinePointerKey(REPO, 'master', 'benchmark', TIME, SHA_A),
      isBaseBranch: true,
    });
  });

  it('puts an upload from a pull request or a fork in no timeline', () => {
    expect(plan(null)).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark.json`,
      timeline: null,
      pointerKey: null,
      isBaseBranch: false,
    });
  });

  it("puts a named run on a tracked branch in its own timeline and file, not the branch's", () => {
    expect(plan('master', 'release')).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark@release.json`,
      timeline: '@release',
      pointerKey: timelinePointerKey(REPO, '@release', 'benchmark', TIME, SHA_A),
      isBaseBranch: true,
    });
  });

  it("keeps a named run's report from a pull request in its own file, in no timeline", () => {
    expect(plan(null, 'release')).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark@release.json`,
      timeline: null,
      pointerKey: null,
      isBaseBranch: false,
    });
  });

  it('keeps a named timeline apart from a branch of the same name', () => {
    expect(plan('master', 'master')).toMatchObject({ timeline: '@master' });
  });

  it.each(['Release', 'a/b', '-release', '@release', ''])(
    'refuses the timeline name %j',
    (requested) => {
      expect(plan('master', requested)).toEqual({
        error: expect.stringContaining('Invalid timeline'),
      });
    },
  );
});

describe('uploadTimeSchema', () => {
  it('takes milliseconds and refuses seconds', () => {
    expect(uploadTimeSchema.safeParse(TIME).success).toBe(true);
    expect(uploadTimeSchema.safeParse(1_759_000_000).success).toBe(false);
  });
});

describe('isTimeline', () => {
  it('accepts tracked branches and named timelines, nothing else', () => {
    expect(isTimeline('master')).toBe(true);
    expect(isTimeline('@release')).toBe(true);
    expect(isTimeline('release')).toBe(false);
    expect(isTimeline('feature/x')).toBe(false);
  });
});

describe('timeline pointers', () => {
  const prefix = timelinePrefix(REPO, 'master', 'benchmark');

  it('lists pointers newest first, as S3 sorts their keys', () => {
    const keys = [
      timelinePointerKey(REPO, 'master', 'benchmark', TIME, SHA_A),
      timelinePointerKey(REPO, 'master', 'benchmark', TIME + 1_000, SHA_B),
    ].sort();
    expect(parseTimelineKeys(prefix, keys)).toEqual([
      { sha: SHA_B, time: TIME + 1_000 },
      { sha: SHA_A, time: TIME },
    ]);
  });

  it('keeps one entry per commit, at its newest upload', () => {
    const keys = [
      timelinePointerKey(REPO, 'master', 'benchmark', TIME, SHA_A),
      timelinePointerKey(REPO, 'master', 'benchmark', TIME + 2_000, SHA_A),
    ].sort();
    expect(parseTimelineKeys(prefix, keys)).toEqual([{ sha: SHA_A, time: TIME + 2_000 }]);
  });

  it("skips keys that aren't pointers", () => {
    expect(parseTimelineKeys(prefix, [`${prefix}not-a-pointer`])).toEqual([]);
  });
});

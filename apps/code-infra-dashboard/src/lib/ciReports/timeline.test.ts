import { describe, expect, it } from 'vitest';
import {
  isTimeline,
  parseTimelineKeys,
  planUpload,
  timelinePrefix,
  uploadTimeSchema,
} from './timeline';

const REPO = 'mui/material-ui';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TIME = 1_759_000_000_000;
// 9_999_999_999_999 - TIME: pointers count down, so S3 lists the newest first.
const TIME_LEFT = '8240999999999';

function plan(
  branch: string | null,
  requested?: string,
  overrides: { sha?: string; commitTime?: number | undefined } = {},
) {
  return planUpload({
    repo: REPO,
    sha: SHA_A,
    reportType: 'benchmark',
    branch,
    requested,
    commitTime: TIME,
    ...overrides,
  });
}

describe('planUpload', () => {
  it("puts a tracked branch's upload in the branch's timeline, as a base-branch report", () => {
    expect(plan('master')).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark.json`,
      timeline: 'master',
      pointerKey: `artifacts/${REPO}/timeline/master/benchmark/${TIME_LEFT}-${SHA_A}`,
      isBaseBranch: true,
    });
  });

  it("puts a pull request's upload in no timeline", () => {
    expect(plan('feature/x')).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark.json`,
      timeline: null,
      pointerKey: null,
      isBaseBranch: false,
    });
  });

  it('puts an upload without a branch, from a fork or a tag, in no timeline', () => {
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
      pointerKey: `artifacts/${REPO}/timeline/@release/benchmark/${TIME_LEFT}-${SHA_A}`,
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

  it("keeps a tracked branch's upload without the commit's time out of the timeline", () => {
    expect(plan('master', undefined, { commitTime: undefined })).toEqual({
      reportKey: `artifacts/${REPO}/${SHA_A}/benchmark.json`,
      timeline: null,
      pointerKey: null,
      isBaseBranch: true,
    });
  });

  it("refuses a named timeline without the commit's time", () => {
    expect(plan('master', 'release', { commitTime: undefined })).toEqual({
      error: expect.stringContaining('commitTimestamp'),
    });
  });

  it('writes the same pointer when a commit is uploaded again', () => {
    expect(plan('master')).toEqual(plan('master'));
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
  function keyOf(time: number, sha: string): string {
    const planned = plan('master', undefined, { sha, commitTime: time });
    if ('error' in planned || planned.pointerKey === null) {
      throw new Error('Expected a pointer');
    }
    return planned.pointerKey;
  }

  it('lists pointers newest first, as S3 sorts their keys', () => {
    const keys = [keyOf(TIME, SHA_A), keyOf(TIME + 1_000, SHA_B)].sort();
    expect(parseTimelineKeys(prefix, keys)).toEqual([
      { sha: SHA_B, time: TIME + 1_000 },
      { sha: SHA_A, time: TIME },
    ]);
  });

  it("skips keys that aren't pointers", () => {
    expect(parseTimelineKeys(prefix, [`${prefix}not-a-pointer`])).toEqual([]);
  });
});

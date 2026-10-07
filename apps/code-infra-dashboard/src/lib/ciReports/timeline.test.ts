import { describe, expect, it } from 'vitest';
import {
  isTimeline,
  parseTimelineKeys,
  reportKey,
  resolveTimeline,
  timelinePointerKey,
  timelinePrefix,
} from './timeline';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('resolveTimeline', () => {
  it("puts an upload from a tracked branch in the branch's timeline", () => {
    expect(resolveTimeline(undefined, 'master')).toEqual({ timeline: 'master' });
  });

  it('puts an upload from anywhere else in no timeline', () => {
    expect(resolveTimeline(undefined, null)).toEqual({ timeline: null });
  });

  it('keeps a named timeline apart from branch timelines', () => {
    expect(resolveTimeline('release', 'master')).toEqual({ timeline: '@release' });
    expect(resolveTimeline('master', 'master')).toEqual({ timeline: '@master' });
  });

  it('refuses a named timeline from anywhere but a tracked branch', () => {
    expect(resolveTimeline('release', null)).toEqual({
      error: expect.stringContaining('tracked branch'),
    });
  });

  it.each(['Release', 'a/b', '-release', '@release', ''])(
    'refuses the timeline name %j',
    (requested) => {
      expect(resolveTimeline(requested, 'master')).toEqual({
        error: expect.stringContaining('Invalid timeline'),
      });
    },
  );
});

describe('reportKey', () => {
  it("keeps the plain file for a branch's timeline or none", () => {
    expect(reportKey('mui/material-ui', SHA_A, 'benchmark', null)).toBe(
      `artifacts/mui/material-ui/${SHA_A}/benchmark.json`,
    );
    expect(reportKey('mui/material-ui', SHA_A, 'benchmark', 'master')).toBe(
      `artifacts/mui/material-ui/${SHA_A}/benchmark.json`,
    );
  });

  it('gives a named timeline its own file', () => {
    expect(reportKey('mui/material-ui', SHA_A, 'benchmark', '@release')).toBe(
      `artifacts/mui/material-ui/${SHA_A}/benchmark@release.json`,
    );
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
  const prefix = timelinePrefix('mui/material-ui', 'master', 'benchmark');

  it('lists pointers newest first, as S3 sorts their keys', () => {
    const keys = [
      timelinePointerKey('mui/material-ui', 'master', 'benchmark', 1_000, SHA_A),
      timelinePointerKey('mui/material-ui', 'master', 'benchmark', 2_000, SHA_B),
    ].sort();
    expect(parseTimelineKeys(prefix, keys)).toEqual([
      { sha: SHA_B, time: 2_000 },
      { sha: SHA_A, time: 1_000 },
    ]);
  });

  it('keeps one entry per commit, at its newest upload', () => {
    const keys = [
      timelinePointerKey('mui/material-ui', 'master', 'benchmark', 1_000, SHA_A),
      timelinePointerKey('mui/material-ui', 'master', 'benchmark', 3_000, SHA_A),
    ].sort();
    expect(parseTimelineKeys(prefix, keys)).toEqual([{ sha: SHA_A, time: 3_000 }]);
  });

  it("skips keys that aren't pointers", () => {
    expect(parseTimelineKeys(prefix, [`${prefix}not-a-pointer`])).toEqual([]);
  });
});

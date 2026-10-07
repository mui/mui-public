import { describe, expect, it } from 'vitest';
import {
  isTimelineName,
  parseTimelineKeys,
  reportFileName,
  resolveTimeline,
  timelinePointerKey,
  timelinePrefix,
} from './timeline';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('resolveTimeline', () => {
  it.each(['master', 'main', 'next', 'v7.x'])(
    "puts a trusted %s upload in the branch's timeline",
    (branch) => {
      expect(resolveTimeline({ requested: undefined, branch, trusted: true })).toEqual({
        timeline: branch,
      });
    },
  );

  it('puts pull request branches and forks in no timeline', () => {
    expect(resolveTimeline({ requested: undefined, branch: 'feature', trusted: true })).toEqual({
      timeline: null,
    });
    expect(resolveTimeline({ requested: undefined, branch: 'master', trusted: false })).toEqual({
      timeline: null,
    });
  });

  it('takes a named timeline from a trusted tracked branch', () => {
    expect(resolveTimeline({ requested: 'release', branch: 'master', trusted: true })).toEqual({
      timeline: 'release',
    });
  });

  it('refuses a named timeline from a pull request branch or a fork', () => {
    expect(resolveTimeline({ requested: 'release', branch: 'feature', trusted: true })).toEqual({
      error: expect.stringContaining('tracked branch'),
    });
    expect(resolveTimeline({ requested: 'release', branch: 'master', trusted: false })).toEqual({
      error: expect.stringContaining('tracked branch'),
    });
  });

  it.each(['master', 'v7.x', 'Release', 'a/b', '-release', ''])(
    'refuses the timeline name %j',
    (requested) => {
      expect(resolveTimeline({ requested, branch: 'master', trusted: true })).toEqual({
        error: expect.stringContaining('Invalid timeline'),
      });
    },
  );
});

describe('reportFileName', () => {
  it("keeps the plain name for a branch's timeline or none", () => {
    expect(reportFileName('benchmark', null)).toBe('benchmark.json');
    expect(reportFileName('benchmark', 'master')).toBe('benchmark.json');
  });

  it('gives a named timeline its own file', () => {
    expect(reportFileName('benchmark', 'release')).toBe('benchmark@release.json');
  });
});

describe('isTimelineName', () => {
  it('accepts tracked branches and valid names, nothing else', () => {
    expect(isTimelineName('master')).toBe(true);
    expect(isTimelineName('release')).toBe(true);
    expect(isTimelineName('feature/x')).toBe(false);
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

  it("skips keys that aren't this timeline's pointers", () => {
    const keys = [
      timelinePointerKey('mui/material-ui', 'release', 'benchmark', 1_000, SHA_A),
      `${prefix}not-a-pointer`,
    ];
    expect(parseTimelineKeys(prefix, keys)).toEqual([]);
  });
});

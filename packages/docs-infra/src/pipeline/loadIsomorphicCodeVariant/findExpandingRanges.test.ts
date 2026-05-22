import { describe, it, expect } from 'vitest';
import {
  findExpandingRanges,
  hasExpandingRanges,
  EXPANDING_START_MARKER,
  EXPANDING_END_MARKER,
  EXPANDING_SINGLE_MARKER,
} from './findExpandingRanges';

describe('findExpandingRanges', () => {
  it('returns an empty array when comments is undefined', () => {
    expect(findExpandingRanges(undefined)).toEqual([]);
  });

  it('returns an empty array when comments is empty', () => {
    expect(findExpandingRanges({})).toEqual([]);
  });

  it('returns an empty array when no entry contains a marker', () => {
    expect(findExpandingRanges({ 1: ['// hello'], 3: ['// world'] })).toEqual([]);
  });

  it('returns a single inclusive range from a start/end pair', () => {
    expect(
      findExpandingRanges({
        1: [`// ${EXPANDING_START_MARKER}`],
        3: [`// ${EXPANDING_END_MARKER}`],
      }),
    ).toEqual([[1, 3]]);
  });

  it('treats a same-line start+end as a single-line range', () => {
    expect(
      findExpandingRanges({
        2: [`// ${EXPANDING_START_MARKER}`, `// ${EXPANDING_END_MARKER}`],
      }),
    ).toEqual([[2, 2]]);
  });

  it('returns multiple ranges in ascending order', () => {
    expect(
      findExpandingRanges({
        1: [EXPANDING_START_MARKER],
        2: [EXPANDING_END_MARKER],
        5: [EXPANDING_START_MARKER],
        7: [EXPANDING_END_MARKER],
      }),
    ).toEqual([
      [1, 2],
      [5, 7],
    ]);
  });

  it('matches markers as substrings (decorated comments still parse)', () => {
    expect(
      findExpandingRanges({
        1: [`/* api-key block ${EXPANDING_START_MARKER} */`],
        4: [`/* ${EXPANDING_END_MARKER} api-key block */`],
      }),
    ).toEqual([[1, 4]]);
  });

  it('drops an unmatched start with no following end', () => {
    expect(
      findExpandingRanges({
        1: [EXPANDING_START_MARKER],
        3: ['// hello'],
      }),
    ).toEqual([]);
  });

  it('drops an unmatched end with no preceding start', () => {
    expect(
      findExpandingRanges({
        1: ['// hello'],
        3: [EXPANDING_END_MARKER],
      }),
    ).toEqual([]);
  });

  it('a second start before close replaces the open range origin', () => {
    expect(
      findExpandingRanges({
        1: [EXPANDING_START_MARKER],
        3: [EXPANDING_START_MARKER],
        5: [EXPANDING_END_MARKER],
      }),
    ).toEqual([[3, 5]]);
  });

  it('ignores non-string entries gracefully', () => {
    // Defensive: SourceComments is typed `string[]` but external callers
    // sometimes pass through values that round-trip via JSON and end up
    // with unexpected element types. Don't crash.
    const comments = {
      1: [null, undefined, EXPANDING_START_MARKER] as unknown as string[],
      2: [EXPANDING_END_MARKER],
    };
    expect(findExpandingRanges(comments)).toEqual([[1, 2]]);
  });

  it('ignores zero and negative line numbers', () => {
    expect(
      findExpandingRanges({
        0: [EXPANDING_START_MARKER],
        [-1]: [EXPANDING_END_MARKER],
        2: [EXPANDING_START_MARKER],
        4: [EXPANDING_END_MARKER],
      }),
    ).toEqual([[2, 4]]);
  });

  describe('single-line @expanding marker', () => {
    it('produces a single-line range', () => {
      expect(findExpandingRanges({ 3: [EXPANDING_SINGLE_MARKER] })).toEqual([[3, 3]]);
    });

    it('matches as a substring of a decorated comment', () => {
      expect(findExpandingRanges({ 1: [`// ${EXPANDING_SINGLE_MARKER} api key`] })).toEqual([
        [1, 1],
      ]);
    });

    it('does not match inside `@expanding-start` / `@expanding-end`', () => {
      // Only the paired range should be produced — the start/end
      // markers must not double-count as single-line markers.
      expect(
        findExpandingRanges({
          1: [EXPANDING_START_MARKER],
          3: [EXPANDING_END_MARKER],
        }),
      ).toEqual([[1, 3]]);
    });

    it('coexists with range markers on different lines', () => {
      expect(
        findExpandingRanges({
          1: [EXPANDING_SINGLE_MARKER],
          3: [EXPANDING_START_MARKER],
          5: [EXPANDING_END_MARKER],
          7: [EXPANDING_SINGLE_MARKER],
        }),
      ).toEqual([
        [1, 1],
        [3, 5],
        [7, 7],
      ]);
    });
  });
});

describe('hasExpandingRanges', () => {
  it('returns false for undefined / empty / marker-less comments', () => {
    expect(hasExpandingRanges(undefined)).toBe(false);
    expect(hasExpandingRanges({})).toBe(false);
    expect(hasExpandingRanges({ 1: ['// hello'] })).toBe(false);
  });

  it('returns true on the first complete pair', () => {
    expect(
      hasExpandingRanges({
        1: [EXPANDING_START_MARKER],
        2: [EXPANDING_END_MARKER],
      }),
    ).toBe(true);
  });

  it('returns true for a same-line start+end', () => {
    expect(hasExpandingRanges({ 1: [EXPANDING_START_MARKER, EXPANDING_END_MARKER] })).toBe(true);
  });

  it('returns false for an unpaired start', () => {
    expect(hasExpandingRanges({ 1: [EXPANDING_START_MARKER] })).toBe(false);
  });

  it('returns true for a standalone @expanding marker', () => {
    expect(hasExpandingRanges({ 4: [EXPANDING_SINGLE_MARKER] })).toBe(true);
  });
});

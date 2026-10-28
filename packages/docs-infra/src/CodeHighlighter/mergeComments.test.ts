import { describe, it, expect, vi } from 'vitest';
import type { SourceComments } from './types';
import { mergeComments } from './mergeComments';

describe('mergeComments', () => {
  it('returns undefined when both inputs are undefined', () => {
    expect(mergeComments(undefined, undefined)).toBeUndefined();
  });

  it('returns a copy of `input` when `mine` is undefined', () => {
    const input: SourceComments = { 1: ['// a'] };
    const result = mergeComments(input, undefined);
    expect(result).toEqual({ 1: ['// a'] });
    expect(result).not.toBe(input);
  });

  it('returns a copy of `mine` when `input` is undefined', () => {
    const mine: SourceComments = { 2: ['// b'] };
    const result = mergeComments(undefined, mine);
    expect(result).toEqual({ 2: ['// b'] });
    expect(result).not.toBe(mine);
  });

  it('returns undefined when both inputs are empty objects', () => {
    expect(mergeComments({}, {})).toBeUndefined();
  });

  it('combines disjoint line sets', () => {
    expect(mergeComments({ 1: ['// a'] }, { 2: ['// b'] })).toEqual({
      1: ['// a'],
      2: ['// b'],
    });
  });

  it('concatenates per-line entries with input first, mine appended', () => {
    expect(mergeComments({ 1: ['// a', '// b'] }, { 1: ['// c'] })).toEqual({
      1: ['// a', '// b', '// c'],
    });
  });

  it('preserves the line ordering of mine when input has no entry for that line', () => {
    expect(mergeComments({ 1: ['// a'] }, { 1: ['// b'], 5: ['// c'] })).toEqual({
      1: ['// a', '// b'],
      5: ['// c'],
    });
  });

  it('does not mutate either input', () => {
    const input: SourceComments = { 1: ['// a'] };
    const mine: SourceComments = { 1: ['// b'] };
    mergeComments(input, mine);
    expect(input).toEqual({ 1: ['// a'] });
    expect(mine).toEqual({ 1: ['// b'] });
  });

  it('returns a fresh per-line array (mutating the result does not leak)', () => {
    const input: SourceComments = { 1: ['// a'] };
    const result = mergeComments(input, undefined)!;
    result[1].push('// added');
    expect(input[1]).toEqual(['// a']);
  });

  it('skips line entries that are empty arrays in both inputs', () => {
    expect(mergeComments({ 1: [] }, { 1: [] })).toBeUndefined();
  });

  describe('indexing-mismatch dev warning', () => {
    it('warns when one input has a `0` key and the other does not', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mergeComments({ 0: ['// a'] }, { 1: ['// b'] });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/different line-indexing conventions/);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when both inputs use the same convention (both 1-indexed)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mergeComments({ 1: ['// a'], 3: ['// c'] }, { 1: ['// b'], 5: ['// d'] });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when both inputs use the same convention (both contain `0`)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mergeComments({ 0: ['// a'], 2: ['// c'] }, { 0: ['// b'] });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when one input is empty', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mergeComments({ 0: ['// a'] }, {});
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});

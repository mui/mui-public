import type { SourceComments } from '../../CodeHighlighter/types';

/**
 * Sentinel substrings a transformer puts into its returned `comments`
 * map to mark newly-added lines. The markers are metadata only — they
 * never appear in the rendered source text.
 * Detection is substring-based so callers can decorate them however
 * reads best alongside any neighbouring comments
 * (e.g. `'// @expanding-start (api key)'`).
 *
 * Two flavours:
 * - `@expanding-start` / `@expanding-end` delimit a contiguous,
 *   multi-line range (inclusive on both ends).
 * - `@expanding` on its own marks a single added line — equivalent
 *   to a same-line start+end pair, but easier to write when the
 *   addition is just one line.
 */
export const EXPANDING_START_MARKER = '@expanding-start';
export const EXPANDING_END_MARKER = '@expanding-end';
export const EXPANDING_SINGLE_MARKER = '@expanding';

// `@expanding` not followed by `-` — distinguishes the single-line
// marker from the `-start` / `-end` variants without false matches.
const SINGLE_MARKER_PATTERN = /@expanding(?!-)/;

function classifyEntries(entries: string[] | undefined): {
  hasStart: boolean;
  hasEnd: boolean;
  hasSingle: boolean;
} {
  let hasStart = false;
  let hasEnd = false;
  let hasSingle = false;
  if (!entries) {
    return { hasStart, hasEnd, hasSingle };
  }
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      continue;
    }
    if (entry.includes(EXPANDING_START_MARKER)) {
      hasStart = true;
    }
    if (entry.includes(EXPANDING_END_MARKER)) {
      hasEnd = true;
    }
    if (SINGLE_MARKER_PATTERN.test(entry)) {
      hasSingle = true;
    }
  }
  return { hasStart, hasEnd, hasSingle };
}

function collectLineNumbers(comments: SourceComments): number[] {
  const lineNumbers: number[] = [];
  for (const key of Object.keys(comments)) {
    const line = Number(key);
    if (Number.isFinite(line) && line > 0) {
      lineNumbers.push(line);
    }
  }
  lineNumbers.sort((a, b) => a - b);
  return lineNumbers;
}

/**
 * Scans a `SourceComments` map for `@expanding`, `@expanding-start`,
 * and `@expanding-end` markers and returns the inclusive 1-indexed
 * line ranges they delimit.
 *
 * Pairing rule: walk lines in ascending order. A standalone
 * `@expanding` immediately produces a single-line `[line, line]`
 * range. For ranges, the first `@expanding-start` opens a range and
 * the next `@expanding-end` closes it. Unpaired range markers (a
 * start with no matching end, or an end with no preceding start) are
 * silently dropped — the most likely cause is a transformer
 * mid-iteration and the safe behaviour is "no animation for that
 * fragment" rather than either crashing or treating an unbounded
 * region. Nested or overlapping ranges are not supported; a second
 * `@expanding-start` before the previous one is closed replaces the
 * open range's start.
 *
 * @param comments - The remapped 1-indexed comments map.
 * @returns Sorted `[startLine, endLine]` pairs (inclusive on both
 *   ends). Returns an empty array when `comments` is `undefined`,
 *   empty, or contains no markers.
 */
export function findExpandingRanges(comments: SourceComments | undefined): Array<[number, number]> {
  if (!comments) {
    return [];
  }
  const lineNumbers = collectLineNumbers(comments);
  if (lineNumbers.length === 0) {
    return [];
  }

  const ranges: Array<[number, number]> = [];
  let openStart: number | null = null;
  for (const line of lineNumbers) {
    const { hasStart, hasEnd, hasSingle } = classifyEntries(comments[line]);
    if (hasSingle) {
      ranges.push([line, line]);
    }
    // Same-line start+end (multi-line addition collapsed to one line)
    // is a valid range.
    if (hasStart && hasEnd) {
      ranges.push([line, line]);
      openStart = null;
      continue;
    }
    if (hasStart) {
      openStart = line;
      continue;
    }
    if (hasEnd && openStart !== null) {
      ranges.push([openStart, line]);
      openStart = null;
    }
  }
  return ranges;
}

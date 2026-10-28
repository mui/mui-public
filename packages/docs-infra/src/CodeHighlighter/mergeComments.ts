import type { SourceComments } from './types';

/**
 * Merges two `SourceComments` maps by concatenating entries per line.
 *
 * Both maps are keyed by line number. The function does not interpret
 * keys — it only matches them by value — so 0-indexed and 1-indexed
 * conventions are both supported, but **both inputs must use the same
 * convention**. The repository's `SourceTransformer` contract supplies
 * 1-indexed line numbers; if you build `mine` by hand, match the
 * upstream indexing of `input` or your markers will land on the wrong
 * lines.
 *
 * In non-production builds a heuristic dev warning is emitted when the
 * two inputs look like they disagree about indexing (one contains a
 * `0` key and the other does not). The check has no runtime cost in
 * production builds.
 *
 * For any line present in either map, the resulting entry is
 * `[...input[line] ?? [], ...mine[line] ?? []]` — `input` markers come
 * first, the transformer's own markers (`mine`) are appended.
 *
 * Returns `undefined` when the merge would produce no entries (both
 * inputs absent, both empty, or every per-line array empty). Otherwise
 * returns a fresh object whose per-line arrays are also fresh copies,
 * so callers may safely mutate the result without affecting either
 * input.
 *
 * Intended to be called by `SourceTransformer` implementations that
 * receive an upstream `comments` map as their 3rd argument and want to
 * preserve those entries alongside the markers they themselves emit.
 *
 * @param input - Comments map received by the transformer (may be
 *   `undefined` when no upstream comments exist).
 * @param mine - Comments map the transformer wants to emit (may be
 *   `undefined` when the transformer has none of its own). Must use
 *   the same line-indexing convention as `input`.
 */
export function mergeComments(
  input: SourceComments | undefined,
  mine: SourceComments | undefined,
): SourceComments | undefined {
  if (!input && !mine) {
    return undefined;
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    input &&
    mine &&
    Object.keys(input).length > 0 &&
    Object.keys(mine).length > 0
  ) {
    warnOnIndexingMismatch(input, mine);
  }

  const result: SourceComments = {};
  const lines = new Set<number>();
  if (input) {
    for (const key of Object.keys(input)) {
      lines.add(Number(key));
    }
  }
  if (mine) {
    for (const key of Object.keys(mine)) {
      lines.add(Number(key));
    }
  }

  let hasAny = false;
  for (const line of lines) {
    const merged = [...(input?.[line] ?? []), ...(mine?.[line] ?? [])];
    if (merged.length > 0) {
      result[line] = merged;
      hasAny = true;
    }
  }

  return hasAny ? result : undefined;
}

function warnOnIndexingMismatch(input: SourceComments, mine: SourceComments): void {
  const inputHasZero = Object.prototype.hasOwnProperty.call(input, 0);
  const mineHasZero = Object.prototype.hasOwnProperty.call(mine, 0);
  if (inputHasZero === mineHasZero) {
    return;
  }

  // Only warn when the side without a `0` key has at least one entry
  // — otherwise we can't tell whether it would have included one.
  const other = inputHasZero ? mine : input;
  if (Object.keys(other).length === 0) {
    return;
  }

  console.warn(
    'mergeComments: inputs appear to use different line-indexing conventions ' +
      '(one contains a `0` key, the other does not). Comments are 1-indexed everywhere ' +
      '(a `0` key means something emitted 0-indexed comments); both inputs must be ' +
      '1-indexed or markers will land on the wrong lines.',
  );
}

import type { SourceComments } from './types';

/**
 * Merges two `SourceComments` maps by concatenating entries per line.
 *
 * Both maps are keyed by line number (0- or 1-indexed; the function is
 * agnostic — the caller is responsible for consistent indexing). For
 * any line present in either map, the resulting entry is
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
 *   `undefined` when the transformer has none of its own).
 */
export function mergeComments(
  input: SourceComments | undefined,
  mine: SourceComments | undefined,
): SourceComments | undefined {
  if (!input && !mine) {
    return undefined;
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

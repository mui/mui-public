import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import type { HastRoot, VariantSource, VariantCode, Code } from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';

export interface SourceLineCounts {
  totalLines: number;
  focusedLines: number;
  collapsible: boolean;
}

const ZERO_LINE_COUNTS: SourceLineCounts = {
  totalLines: 0,
  focusedLines: 0,
  collapsible: false,
};

function normalizeLineCounts(
  totalRaw: unknown,
  focusedRaw: unknown,
  collapsibleRaw?: unknown,
): SourceLineCounts {
  const totalNum = totalRaw == null ? NaN : Number(totalRaw);
  const totalLines = Number.isFinite(totalNum) && totalNum >= 0 ? totalNum : 0;
  const focusedNum = focusedRaw == null ? NaN : Number(focusedRaw);
  const focusedLines = Number.isFinite(focusedNum) && focusedNum >= 0 ? focusedNum : totalLines;
  return {
    totalLines,
    focusedLines,
    collapsible: collapsibleRaw === true,
  };
}

function readStoredLineCounts(file: {
  totalLines?: unknown;
  focusedLines?: unknown;
  collapsible?: unknown;
}): SourceLineCounts | null {
  if (file.totalLines === undefined) {
    return null;
  }
  return normalizeLineCounts(file.totalLines, file.focusedLines, file.collapsible);
}

/**
 * Cache of `{ totalLines, focusedLines }` keyed on the raw source
 * payload. Variant sources are typically stable references across
 * re-renders (they live on the precomputed manifest) so caching by
 * identity is safe and avoids re-parsing compressed hast on every
 * layout-shift classification.
 */
const sourceLineCountsCache = new WeakMap<object, SourceLineCounts>();

function readHastLineCounts(root: HastRoot | undefined): SourceLineCounts {
  if (!root || !root.data) {
    return ZERO_LINE_COUNTS;
  }
  const totalRaw = (root.data as { totalLines?: unknown }).totalLines;
  const focusedRaw = (root.data as { focusedLines?: unknown }).focusedLines;
  const collapsibleRaw = (root.data as { collapsible?: unknown }).collapsible;
  return normalizeLineCounts(totalRaw, focusedRaw, collapsibleRaw);
}

/**
 * Extract `{ totalLines, focusedLines }` from any `VariantSource`
 * shape. Reads precomputed metadata when available (`HastRoot.data`)
 * and falls back to counting lines for plain string sources. For
 * string sources, `focusedLines === totalLines` because the
 * `@focus` enhancer never ran. Results are cached by source identity
 * for object payloads so subsequent calls are O(1).
 *
 * Returns zeroes when the source is missing or malformed.
 */
export function getSourceLineCounts(
  source: VariantSource | undefined,
  fallback?: FallbackNode[],
): SourceLineCounts {
  if (source == null) {
    return ZERO_LINE_COUNTS;
  }
  if (typeof source === 'string') {
    const total = source.length === 0 ? 0 : source.split('\n').length;
    return { totalLines: total, focusedLines: total, collapsible: false };
  }
  const cached = sourceLineCountsCache.get(source);
  if (cached) {
    return cached;
  }
  let counts: SourceLineCounts;
  if (typeof source === 'object' && ('hastJson' in source || 'hastCompressed' in source)) {
    counts = readHastLineCounts(decodeHastSource(source, fallback) ?? undefined);
  } else {
    counts = readHastLineCounts(source as HastRoot);
  }
  sourceLineCountsCache.set(source, counts);
  return counts;
}

const variantTotalLinesCache = new WeakMap<object, number>();

/**
 * Sum `totalLines` across every file in a variant (main file +
 * `extraFiles`). Used by `variantHasLayoutShift` in `'all'` mode to
 * decide whether the aggregate height changes when switching
 * variants. Memoized per variant identity.
 */
function sumVariantTotalLines(variant: VariantCode): number {
  const cached = variantTotalLinesCache.get(variant);
  if (cached !== undefined) {
    return cached;
  }
  let sum = variant.fileName
    ? (getVariantFileLineCounts(variant, variant.fileName)?.totalLines ?? 0)
    : getSourceLineCounts(variant.source, variant.fallback).totalLines;
  if (variant.extraFiles) {
    for (const [fileName, file] of Object.entries(variant.extraFiles)) {
      if (file == null) {
        continue;
      }
      sum += getVariantFileLineCounts(variant, fileName)?.totalLines ?? 0;
    }
  }
  variantTotalLinesCache.set(variant, sum);
  return sum;
}

export function getVariantFileLineCounts(
  variant: VariantCode,
  fileName: string,
): SourceLineCounts | null {
  if ('fileName' in variant && variant.fileName === fileName) {
    if (variant.source === undefined) {
      return null;
    }
    const stored = readStoredLineCounts(variant);
    if (stored) {
      return stored;
    }
    return getSourceLineCounts(variant.source, variant.fallback);
  }
  const extra = variant.extraFiles?.[fileName];
  if (extra === undefined) {
    return null;
  }
  if (typeof extra === 'string') {
    const total = extra.length === 0 ? 0 : extra.split('\n').length;
    return { totalLines: total, focusedLines: total, collapsible: false };
  }
  if (extra.source !== undefined) {
    const stored = readStoredLineCounts(extra);
    if (stored) {
      return stored;
    }
    return getSourceLineCounts(extra.source, extra.fallback);
  }
  return null;
}

function getVariantCode(effectiveCode: Code, variantKey: string): VariantCode | null {
  const variant = effectiveCode[variantKey];
  if (!variant || typeof variant !== 'object' || !('source' in variant)) {
    return null;
  }
  return variant;
}

/**
 * Determines whether switching from `fromVariantKey` to `toVariantKey`
 * would visibly shift layout. The `mode` mirrors the transform
 * classifier and is configured via `useCode`'s `variantLayoutShift`
 * option:
 *
 *   - `'all'` — sums `totalLines` across every file (main +
 *     `extraFiles`) in both variants. Layout shift when the totals
 *     differ. Useful when the rendering surface displays the full
 *     variant simultaneously.
 *   - `'selected'` (default) — compares `totalLines` for the
 *     currently-selected file (`selectedFileName`, falling back to
 *     the source variant's main file) between the two variants.
 *     Layout shift when the line counts differ.
 *   - `'focus'` — like `'selected'` but consults `focusedLines`
 *     (the size of the visible window when the surrounding code
 *     block is collapsed) while `expanded === false`. Reverts to
 *     `'selected'`-style behavior when expanded. Recommended for
 *     demos that use `@focus`/`@padding` to collapse to a region.
 *
 * Returns `true` (layout shift) when:
 *   - either variant is missing,
 *   - the selected file is missing from either variant (the file
 *     list itself changes),
 *   - the relevant line count differs between the two variants.
 *
 * Returns `false` for same-variant swaps and when the line counts
 * match.
 */
export function variantHasLayoutShift(
  effectiveCode: Code,
  fromVariantKey: string | null,
  toVariantKey: string | null,
  opts?: {
    mode?: 'all' | 'selected' | 'focus';
    selectedFileName?: string | undefined;
    expanded?: boolean;
  },
): boolean {
  if (!fromVariantKey || !toVariantKey || fromVariantKey === toVariantKey) {
    return false;
  }
  const fromVariant = getVariantCode(effectiveCode, fromVariantKey);
  const toVariant = getVariantCode(effectiveCode, toVariantKey);
  if (!fromVariant || !toVariant) {
    return false;
  }

  const mode = opts?.mode ?? 'selected';
  const expanded = opts?.expanded ?? false;

  if (mode === 'all') {
    return sumVariantTotalLines(fromVariant) !== sumVariantTotalLines(toVariant);
  }

  // `'selected'` / `'focus'` default to the from-variant's main file
  // when no selection is supplied — mirrors the runtime's "render the
  // main file by default" behavior.
  let fileName = opts?.selectedFileName;
  if (fileName === undefined && 'fileName' in fromVariant) {
    fileName = fromVariant.fileName as string | undefined;
  }
  // No resolvable file name (e.g. an inline-only variant without
  // `fileName`): fall back to the aggregate `totalLines` comparison
  // used by `'all'` mode so wildly different variants still register
  // as layout-shifting instead of silently returning `false`.
  if (!fileName) {
    return sumVariantTotalLines(fromVariant) !== sumVariantTotalLines(toVariant);
  }

  const fromCounts = getVariantFileLineCounts(fromVariant, fileName);
  const toCounts = getVariantFileLineCounts(toVariant, fileName);
  // File missing on either side means the file list itself changes,
  // which is inherently layout-shifting.
  if (!fromCounts || !toCounts) {
    return true;
  }
  if (mode === 'focus' && !expanded) {
    return fromCounts.focusedLines !== toCounts.focusedLines;
  }
  return fromCounts.totalLines !== toCounts.totalLines;
}

/**
 * Description of a pair of variants whose same-named file has a
 * different `focusedLines` count. Returned by
 * `findVariantFocusedLinesMismatches` so callers can produce
 * actionable error messages without re-walking the variant tree.
 */
export interface VariantFocusedLinesMismatch {
  fileName: string;
  variantA: string;
  variantB: string;
  focusedLinesA: number;
  focusedLinesB: number;
}

/**
 * Walk every variant on `effectiveCode` and collect files that share
 * a name across variants but disagree on `focusedLines`. Used by
 * `useCode`'s `strictMatchingVariantFocusedLines` option to throw
 * with a pointer to the offending variants/file so the demo author
 * can align the `@focus` / `@padding` markers across language
 * variants and avoid coordinated barriers while collapsed.
 *
 * The first variant to declare a given file name is treated as the
 * baseline; every subsequent variant that disagrees produces a
 * mismatch entry paired with the baseline. Returns an empty array
 * when every shared file agrees.
 */
export function findVariantFocusedLinesMismatches(
  effectiveCode: Code,
): VariantFocusedLinesMismatch[] {
  const baseline = new Map<string, { variantName: string; focusedLines: number }>();
  const mismatches: VariantFocusedLinesMismatch[] = [];

  const recordFile = (variantName: string, fileName: string, focusedLines: number) => {
    const existing = baseline.get(fileName);
    if (!existing) {
      baseline.set(fileName, { variantName, focusedLines });
      return;
    }
    if (existing.focusedLines !== focusedLines) {
      mismatches.push({
        fileName,
        variantA: existing.variantName,
        variantB: variantName,
        focusedLinesA: existing.focusedLines,
        focusedLinesB: focusedLines,
      });
    }
  };

  for (const [variantName, variant] of Object.entries(effectiveCode)) {
    if (!variant || typeof variant !== 'object' || !('source' in variant)) {
      continue;
    }
    if ('fileName' in variant && variant.fileName && variant.source !== undefined) {
      const { focusedLines } =
        getVariantFileLineCounts(variant, variant.fileName) ??
        getSourceLineCounts(variant.source, variant.fallback);
      recordFile(variantName, variant.fileName, focusedLines);
    }
    if ('extraFiles' in variant && variant.extraFiles) {
      for (const [fileName, file] of Object.entries(variant.extraFiles)) {
        if (file == null) {
          continue;
        }
        if (typeof file === 'string') {
          const total = file.length === 0 ? 0 : file.split('\n').length;
          recordFile(variantName, fileName, total);
        } else if (file.source !== undefined) {
          const { focusedLines } =
            getVariantFileLineCounts(variant, fileName) ??
            getSourceLineCounts(file.source, file.fallback);
          recordFile(variantName, fileName, focusedLines);
        }
      }
    }
  }
  return mismatches;
}

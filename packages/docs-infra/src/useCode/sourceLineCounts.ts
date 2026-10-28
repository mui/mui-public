import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import type { HastRoot, VariantSource, VariantCode } from '../CodeHighlighter/types';
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

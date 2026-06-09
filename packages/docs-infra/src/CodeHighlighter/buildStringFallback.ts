import type { Root as HastRoot } from 'hast';
import type { SourceComments, SourceEnhancers } from './types';
import { type FallbackNode, buildRootFallback } from './fallbackFormat';
import { parsePlainText } from '../pipeline/parseSource';

export interface StringFallbackResult {
  /** Compact, windowed fallback frames (text only — `.line` spans stripped). */
  fallback: FallbackNode[];
  /** Total source lines. */
  totalLines: number;
  /** Lines visible in the collapsed window (the sum of visible frame sizes). */
  focusedLines: number;
  /** Whether the enhanced frame structure has hidden content to expand into. */
  collapsible: boolean;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Derive a *windowed* fallback for a plain-string source by running the same
 * `sourceEnhancers` the live render uses over a cheap line-guttered HAST
 * (`parsePlainText` — gutters, no syntax highlighting). The inline-string
 * fallback path otherwise wraps the whole source in one un-windowed focus frame,
 * so an oversized / `@focus` / `@highlight` block paints its full text before
 * hydration then snaps to the collapsed window. Running the enhancers here makes
 * the loading frames match the live render, and the resulting `root.data` carries
 * the `totalLines` / `focusedLines` the compact fallback can't preserve.
 *
 * Synchronous by design — it runs at server fallback-prep time inside the
 * (sync) `prepareInitialSource`. An enhancer that returns a promise is skipped
 * (returns `undefined`) so the caller falls back to the naive single-frame wrap
 * rather than blocking; the built-in `enhanceCodeEmphasis` is synchronous, so
 * the common case windows.
 */
export function buildStringFallback(
  source: string,
  comments: SourceComments | undefined,
  fileName: string,
  sourceEnhancers: SourceEnhancers,
): StringFallbackResult | undefined {
  let root: HastRoot = parsePlainText(source);

  for (const enhancer of sourceEnhancers) {
    const result = enhancer(root, comments, fileName);
    if (isPromiseLike(result)) {
      return undefined;
    }
    root = result;
  }

  const data = root.data as
    | { totalLines?: number; focusedLines?: number; collapsible?: boolean }
    | undefined;
  const totalLines = data?.totalLines ?? 0;
  const focusedLines = data?.focusedLines ?? totalLines;
  const collapsible = data?.collapsible === true;

  return { fallback: buildRootFallback(root), totalLines, focusedLines, collapsible };
}

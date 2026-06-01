import type { HastRoot, SourceComments, SourceEnhancer } from '../../CodeHighlighter/types';

// Lazy form of `enhanceCodeEmphasis`. The real enhancer is ~13 KB gzip (frame
// range / indent logic); this wrapper keeps it out of the initial bundle and
// dynamic-imports it only when a block actually enhances client-side. A
// precomputed block's HAST already carries the emphasis (recorded under the
// same `enhancerName`), so `shouldSkipEnhancer` skips this wrapper without ever
// importing the chunk. `CodeProviderLazy` uses this; the eager `CodeProvider`
// uses the bundled `enhanceCodeEmphasis` directly so its zero-fetch invariant
// holds.
//
// Must stay light: only types are statically imported; the heavy module is
// reached exclusively through the dynamic `import()` below.

// Stable name — MUST match `enhanceCodeEmphasis.enhancerName` so a precomputed
// HAST that recorded the eager enhancer is correctly skipped by this wrapper
// (and vice versa). Hardcoded rather than imported to avoid pulling the chunk.
const ENHANCE_CODE_EMPHASIS_NAME = 'enhanceCodeEmphasis';

let cached: SourceEnhancer | undefined;

async function load(): Promise<SourceEnhancer> {
  if (!cached) {
    cached = (await import('./enhanceCodeEmphasis')).enhanceCodeEmphasis;
  }
  return cached;
}

/**
 * Warms the emphasis-enhancer chunk so the next enhancement runs synchronously
 * (no flash during live-edit re-enhancement). Optional — the wrapper loads on
 * first use anyway; this is a head start, e.g. when a block becomes editable.
 */
export async function preloadCodeEmphasis(): Promise<void> {
  await load();
}

/** Clears the module cache. Intended for tests exercising the cold path. */
export function resetCodeEmphasisCache(): void {
  cached = undefined;
}

/**
 * Defers the `enhanceCodeEmphasis` chunk until a block actually enhances
 * (client highlight or live edit). Runs synchronously once the chunk is warm so
 * live-edit re-enhancement does not flash; returns a promise on the first cold
 * call (the existing async-enhancer path handles it). Carries the same
 * `enhancerName` so precomputed HAST skips it without loading anything.
 */
export const enhanceCodeEmphasisLazy: SourceEnhancer = (
  root: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
) => {
  if (cached) {
    return cached(root, comments, fileName);
  }
  return load().then((enhance) => enhance(root, comments, fileName));
};
enhanceCodeEmphasisLazy.enhancerName = ENHANCE_CODE_EMPHASIS_NAME;

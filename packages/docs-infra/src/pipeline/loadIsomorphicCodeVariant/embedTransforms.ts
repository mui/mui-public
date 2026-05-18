import type { HastRoot, Transforms } from '../../CodeHighlighter/types';

/**
 * Splits a `Transforms` map (as produced by `diffHast`, which always
 * carries deltas) into the variant-level `manifest` (no `delta`) and the
 * `embedded` map that should ride inside `source.data.transforms`.
 * Entries with an empty or missing delta are dropped from both.
 *
 * Returns `undefined` when no entry survived — callers should treat that
 * as "no transforms to record".
 *
 * This is the single source of truth for the manifest / embedded split;
 * both `computeHastDeltas` (per-file diffs) and the variant-level embed
 * step in `loadIsomorphicCodeVariant` go through it so the wire shape
 * stays consistent.
 */
export function splitTransformsForEmbed(
  transforms: Transforms,
): { manifest: Transforms; embedded: Transforms } | undefined {
  const manifest: Transforms = {};
  const embedded: Transforms = {};
  let kept = false;
  for (const [transformKey, transformValue] of Object.entries(transforms)) {
    if (
      transformValue?.delta &&
      typeof transformValue.delta === 'object' &&
      Object.keys(transformValue.delta).length > 0
    ) {
      embedded[transformKey] = transformValue;
      manifest[transformKey] = transformValue.fileName ? { fileName: transformValue.fileName } : {};
      kept = true;
    }
  }
  if (!kept) {
    return undefined;
  }
  return { manifest, embedded };
}

/**
 * Embeds `embedded` transforms inside `root.data.transforms` so they ride
 * along inside the (possibly later compressed) hast payload and stay out
 * of the variant-level wire shape that ends up in HTML / module graph.
 */
export function embedTransformsInRoot(root: HastRoot, embedded: Transforms): void {
  root.data = { ...(root.data || {}), transforms: embedded };
}

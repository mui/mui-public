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
      // The manifest entry keeps every field except `delta` (which only
      // ever travels embedded inside `root.data.transforms`). In
      // particular `comments` must survive serialization: transformers
      // that add or relocate lines emit an explicit post-transform map,
      // and the client-side `applyCodeTransformWithComments` consults
      // it in preference to the auto-shift fallback. Dropping it here
      // would silently downgrade those transforms to the wipe-only
      // remap path on hydrated payloads.
      const manifestEntry: Transforms[string] = { ...transformValue };
      delete manifestEntry.delta;
      manifest[transformKey] = manifestEntry;
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

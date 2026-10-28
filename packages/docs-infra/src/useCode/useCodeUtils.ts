import type {
  VariantSource,
  Code,
  Transforms,
  SourceComments,
  EditableSourceProjection,
} from '../CodeHighlighter/types';

export interface TransformedFile {
  name: string;
  originalName: string;
  source: VariantSource;
  sourceProjection?: EditableSourceProjection;
  /**
   * Comments map shifted onto the transformed source's line numbering.
   * Set only when the variant supplied a `comments` map for this file;
   * entries whose source line was wiped by the transform are dropped.
   */
  comments?: SourceComments;
}

export interface TransformedFiles {
  files: TransformedFile[];
  filenameMap: { [originalName: string]: string };
}

/**
 * Pure function to get available transforms from effective code data.
 *
 * Variant-level `transforms` is a manifest produced by `splitTransformsForEmbed`
 * (or by the legacy `Transforms` shape with deltas, for back-compat). Only
 * entries that produced a real source delta are reported here — rename-only
 * entries (manifest entries with `hasDelta: false`, kept around so the
 * runtime can still apply the rename based on user preference) are filtered
 * out so the transform toggle stays hidden when nothing meaningful changes.
 *
 * @param effectiveCode - The effective code object containing all variants
 * @param selectedVariantKey - The currently selected variant key
 * @returns Array of available transform keys (toggle-visible only)
 */
export function getAvailableTransforms(effectiveCode: Code, selectedVariantKey: string): string[] {
  return collectTransformKeys(effectiveCode, selectedVariantKey, { onlyWithDelta: true });
}

/**
 * Like `getAvailableTransforms` but also includes rename-only entries
 * (manifest entries with `hasDelta: false`). Used by the transform
 * resolution path so a stored preference can still apply a rename even
 * when its toggle is hidden because no actual delta exists.
 *
 * @param effectiveCode - The effective code object containing all variants
 * @param selectedVariantKey - The currently selected variant key
 * @returns Array of all applicable transform keys
 */
export function getApplicableTransforms(effectiveCode: Code, selectedVariantKey: string): string[] {
  return collectTransformKeys(effectiveCode, selectedVariantKey, { onlyWithDelta: false });
}

function collectTransformKeys(
  effectiveCode: Code,
  selectedVariantKey: string,
  { onlyWithDelta }: { onlyWithDelta: boolean },
): string[] {
  const transforms = new Set<string>();

  if (!effectiveCode || !selectedVariantKey) {
    return [];
  }

  const variantCode = effectiveCode[selectedVariantKey];
  if (!variantCode || typeof variantCode !== 'object') {
    return [];
  }

  const add = (entries: Transforms | undefined) => {
    if (!entries) {
      return;
    }
    for (const [transformKey, entry] of Object.entries(entries)) {
      if (!entry) {
        continue;
      }
      if (!onlyWithDelta) {
        transforms.add(transformKey);
        continue;
      }
      const inlineDelta =
        !!entry.delta && typeof entry.delta === 'object' && Object.keys(entry.delta).length > 0;
      if (entry.hasDelta || inlineDelta) {
        transforms.add(transformKey);
      }
    }
  };

  if ('transforms' in variantCode) {
    add(variantCode.transforms);
  }

  if ('extraFiles' in variantCode && variantCode.extraFiles) {
    for (const fileData of Object.values(variantCode.extraFiles)) {
      if (fileData && typeof fileData === 'object' && 'transforms' in fileData) {
        add(fileData.transforms);
      }
    }
  }

  return Array.from(transforms);
}

/**
 * Decide whether the rendered `<Pre>` should emit highlighted spans on
 * this render. Two gates compose:
 *
 * 1. `highlightReady` — the render-side readiness gate published by
 *    `CodeHighlighterClient`. `false` while the highlight trigger
 *    (`hydration` / `idle` / `visible`) hasn't fired yet *or* the
 *    sync `parseCode` pass hasn't resolved. The precomputed HAST on
 *    the published `code` would render highlighted spans on first
 *    paint otherwise — defeating the deferred trigger. Treated as
 *    `true` when undefined so legacy/test consumers without a
 *    surrounding context default to rendering highlighted.
 * 2. `deferHighlight` — the narrower pipeline-level signal published
 *    while the incoming variant's parse / transform deltas are still
 *    in flight. Always wins: if the tree isn't ready, highlighting
 *    can't happen.
 */
export function shouldHighlightForRender(args: {
  deferHighlight: boolean | undefined;
  highlightReady?: boolean | undefined;
}): boolean {
  if (args.deferHighlight) {
    return false;
  }
  if (args.highlightReady === false) {
    return false;
  }
  return true;
}

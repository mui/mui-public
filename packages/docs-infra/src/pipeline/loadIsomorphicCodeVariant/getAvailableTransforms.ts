import type { Code, Transforms } from '../../CodeHighlighter/types';

/**
 * Pure function to get available transforms from a specific variant.
 *
 * Variant-level `transforms` is a manifest produced by `splitTransformsForEmbed`
 * (or by the legacy `Transforms` shape with deltas, for back-compat). Only
 * entries that produced a real source delta are reported here — rename-only
 * entries (manifest entries with `hasDelta: false`, kept around so the
 * runtime can still apply the rename based on user preference) are filtered
 * out so the transform toggle stays hidden when nothing meaningful changes.
 */
export function getAvailableTransforms(
  parsedCode: Code | undefined,
  variantName: string,
): string[] {
  const currentVariant = parsedCode?.[variantName];

  if (!currentVariant || typeof currentVariant !== 'object') {
    return [];
  }

  const transforms = new Set<string>();
  const addIfMeaningful = (entries: Transforms | undefined) => {
    if (!entries) {
      return;
    }
    for (const [transformKey, entry] of Object.entries(entries)) {
      if (!entry) {
        continue;
      }
      // Manifest entries set `hasDelta: true` when a real delta survived
      // serialization. Legacy entries that still carry an inline `delta`
      // also qualify (back-compat for callers that haven't gone through
      // `splitTransformsForEmbed`).
      const inlineDelta =
        !!entry.delta && typeof entry.delta === 'object' && Object.keys(entry.delta).length > 0;
      if (entry.hasDelta || inlineDelta) {
        transforms.add(transformKey);
      }
    }
  };

  addIfMeaningful(currentVariant.transforms);

  if (currentVariant.extraFiles) {
    for (const fileData of Object.values(currentVariant.extraFiles)) {
      if (fileData && typeof fileData === 'object' && 'transforms' in fileData) {
        addIfMeaningful(fileData.transforms);
      }
    }
  }

  return Array.from(transforms);
}

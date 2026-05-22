import { applyCodeTransformWithComments } from '../pipeline/loadIsomorphicCodeVariant/applyCodeTransform';
import type {
  VariantSource,
  VariantCode,
  Code,
  Transforms,
  SourceComments,
} from '../CodeHighlighter/types';

interface TransformedFile {
  name: string;
  originalName: string;
  source: VariantSource;
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
 * Pure helper function to apply transform to a source file.
 *
 * @param source - The source code to transform
 * @param fileName - The filename for the source
 * @param transforms - Available transforms for this source
 * @param selectedTransform - The transform to apply
 * @param comments - Optional 1-indexed comment map for the source. Returned
 *   shifted onto the transformed source's line numbering.
 * @returns Object with transformed source, name, and shifted comments
 */
export function applyTransformToSource(
  source: VariantSource,
  fileName: string,
  transforms: Transforms | undefined,
  selectedTransform: string,
  comments?: SourceComments,
): {
  transformedSource: VariantSource;
  transformedName: string;
  transformedComments?: SourceComments;
} {
  if (!transforms?.[selectedTransform]) {
    return { transformedSource: source, transformedName: fileName, transformedComments: comments };
  }

  try {
    const transformData = transforms[selectedTransform];

    // Apply transform — `applyCodeTransform` will look up the delta inside
    // `source.data.transforms` if `transformData.delta` is absent (manifest
    // mode after embedding).
    const result = applyCodeTransformWithComments(source, transforms, selectedTransform, comments);
    const transformedName = transformData.fileName || fileName;

    return {
      transformedSource: result.source,
      transformedName,
      transformedComments: result.comments,
    };
  } catch (error) {
    console.error(`Transform failed for ${fileName}:`, error);
    return { transformedSource: source, transformedName: fileName, transformedComments: comments };
  }
}

/**
 * Pure function to create transformed files from a variant and selected transform.
 *
 * @param selectedVariant - The currently selected variant
 * @param selectedTransform - The transform to apply
 * @returns Object with transformed files and filename mapping, or undefined if no transform
 */
export function createTransformedFiles(
  selectedVariant: VariantCode | null,
  selectedTransform: string | null,
): TransformedFiles | undefined {
  // Only create transformed files when there's actually a transform selected
  if (!selectedVariant || !selectedTransform) {
    return undefined;
  }

  const files: TransformedFile[] = [];
  const filenameMap: { [originalName: string]: string } = {};

  // First, check if any file has a transform manifest entry for the selected
  // transform. A manifest entry may carry a real embedded delta (`hasDelta: true`)
  // or be rename-only (`hasDelta: false`) — both cases are "meaningful" here
  // because either the source changes or the filename does.
  const variantTransforms =
    'transforms' in selectedVariant ? selectedVariant.transforms : undefined;

  let hasAnyMeaningfulTransform = false;

  // Check main file for the transform key
  if (selectedVariant.fileName && variantTransforms?.[selectedTransform]) {
    hasAnyMeaningfulTransform = true;
  }

  // Check extraFiles for the transform key
  if (!hasAnyMeaningfulTransform && selectedVariant.extraFiles) {
    Object.values(selectedVariant.extraFiles).forEach((fileData) => {
      if (
        fileData &&
        typeof fileData === 'object' &&
        'transforms' in fileData &&
        fileData.transforms?.[selectedTransform]
      ) {
        hasAnyMeaningfulTransform = true;
      }
    });
  }

  // If no file has a meaningful transform, return empty result
  if (!hasAnyMeaningfulTransform) {
    return { files: [], filenameMap: {} };
  }

  // Process main file if we have a fileName and source
  if (selectedVariant.fileName && selectedVariant.source) {
    const {
      transformedSource: mainSource,
      transformedName: mainName,
      transformedComments: mainComments,
    } = applyTransformToSource(
      selectedVariant.source,
      selectedVariant.fileName,
      variantTransforms,
      selectedTransform,
      selectedVariant.comments,
    );

    const fileName = selectedVariant.fileName;
    filenameMap[fileName] = mainName;
    files.push({
      name: mainName,
      originalName: fileName,
      source: mainSource,
      ...(mainComments && { comments: mainComments }),
    });
  }

  // Process extra files
  if (selectedVariant.extraFiles) {
    Object.entries(selectedVariant.extraFiles).forEach(([extraFileName, fileData]) => {
      let source: VariantSource | undefined;
      let transforms: Transforms | undefined;
      let fileComments: SourceComments | undefined;

      // Handle different extraFile structures
      if (typeof fileData === 'string') {
        source = fileData;
        transforms = undefined; // Don't inherit variant transforms for simple string files
      } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
        source = fileData.source;
        transforms = fileData.transforms; // Only use explicit transforms for this file
        fileComments = fileData.comments;
      } else {
        return; // Skip invalid entries
      }

      // Skip if source is undefined
      if (!source) {
        return;
      }

      // Apply transforms if available, otherwise use original source
      let transformedSource = source;
      let transformedName = extraFileName;
      let transformedComments = fileComments;

      if (transforms?.[selectedTransform]) {
        try {
          const transformData = transforms[selectedTransform];
          // The presence of an entry in the (manifest or legacy) transforms
          // record is enough — `applyCodeTransform` will look up the delta
          // inside `source.data.transforms` if it isn't on the entry.
          const result = applyCodeTransformWithComments(
            source,
            transforms,
            selectedTransform,
            fileComments,
          );
          transformedSource = result.source;
          transformedComments = result.comments;
          transformedName = transformData.fileName || extraFileName;
        } catch (error) {
          console.error(`Transform failed for ${extraFileName}:`, error);
          // Continue with original source if transform fails
        }
      }

      // Only update filenameMap and add to files if this doesn't conflict with existing files
      // If a file already exists with the target name, skip this transformation to preserve original files
      const existingFile = files.find((f) => f.name === transformedName);
      if (!existingFile) {
        filenameMap[extraFileName] = transformedName;
        files.push({
          name: transformedName,
          originalName: extraFileName,
          source: transformedSource,
          ...(transformedComments && { comments: transformedComments }),
        });
      } else {
        // If there's a conflict, skip this file with a warning
        console.warn(
          `Transform conflict: ${extraFileName} would transform to ${transformedName} but that name is already taken. Skipping this file.`,
        );
      }
    });
  }

  return { files, filenameMap };
}

/**
 * Determines whether applying `transformKey` to `variant` would introduce
 * `.collapse` placeholders into the rendered hast tree — i.e. whether the
 * swap is layout-affecting and must run through the coordinated barrier.
 *
 * Reads the precomputed `hasCollapse` / `hasCollapseInFocus` flags
 * stored on each transform entry by the pipeline (`diffHast` sets them
 * directly, `splitTransformsForEmbed` propagates them onto the
 * manifest). No tree walking or delta decompression happens at runtime.
 *
 * The `mode` option controls *which* file's transform entry is consulted:
 *
 *   - `'selected'` (default) — Consults only the transform map for the
 *     file identified by `selectedFileName` (or `variant.transforms`
 *     when `selectedFileName === variant.fileName`). When
 *     `selectedFileName` is omitted, treats the variant's main file
 *     (`variant.fileName`) as the selection.
 *   - `'all'` — Iterates every transform map on the variant
 *     (`variant.transforms` + each `extraFiles[*].transforms`) and
 *     returns `true` if any one has `hasCollapse: true`. Useful for
 *     callers that render multiple files simultaneously and need to
 *     coordinate a swap whenever *any* file would shift.
 *   - `'focus'` — Like `'selected'`, but consults
 *     `hasCollapseInFocus` instead of `hasCollapse` whenever
 *     `expanded === false`. Lets consumers skip the coordinated
 *     barrier for transforms whose `.collapse` insertion lands
 *     outside the initially-visible region of a collapsed code block.
 *
 * Falls back to a conservative phase 1 classification for legacy
 * payloads that carry `hasDelta: true` without the precomputed flag —
 * i.e. transforms produced by an older build that predates
 * `hasCollapse`, or constructed by a direct caller bypassing the
 * pipeline. For `hasCollapseInFocus`, entries that lack the field fall
 * back to the value of `hasCollapse` (matching the embed-side default).
 *
 * Returns `false` when every consulted entry has `hasCollapse: false`
 * (or `hasCollapseInFocus: false` in focus mode while collapsed), is
 * rename-only, is absent, or the variant is `null`.
 *
 * @param variant - The variant whose transforms to inspect.
 * @param transformKey - The transform key to classify, or `null`.
 * @param opts - Optional mode + selected-file + expanded context.
 */
export function transformHasCollapsePlaceholder(
  variant: VariantCode | null,
  transformKey: string | null,
  opts?: {
    mode?: 'all' | 'selected' | 'focus';
    selectedFileName?: string | undefined;
    expanded?: boolean;
  },
): boolean {
  if (!variant || !transformKey) {
    return false;
  }

  const mode = opts?.mode ?? 'selected';
  const expanded = opts?.expanded ?? false;
  // `'selected'`/`'focus'` default to the variant's main file when no
  // selection is supplied. This lines up with the runtime's "render
  // the main file by default" behavior.
  const selectedFileName =
    opts?.selectedFileName ??
    (mode === 'all'
      ? undefined
      : 'fileName' in variant
        ? (variant.fileName as string | undefined)
        : undefined);

  // In focus mode while collapsed, the relevant precomputed flag is
  // the focus-scoped one. Everywhere else we still consult plain
  // `hasCollapse`. The `useFocusFlag` decision is taken once up front
  // so the per-entry checks stay branch-free.
  const useFocusFlag = mode === 'focus' && !expanded;

  const checkEntry = (entry: Transforms[string] | undefined): boolean => {
    if (!entry) {
      return false;
    }
    if (useFocusFlag) {
      // Prefer the focus-scoped flag; legacy payloads (no
      // `hasCollapseInFocus` field) fall through to `hasCollapse`
      // which itself falls back to the conservative phase 1
      // classification below.
      if (entry.hasCollapseInFocus === true) {
        return true;
      }
      if (entry.hasCollapseInFocus === false) {
        return false;
      }
    }
    if (entry.hasCollapse === true) {
      return true;
    }
    // Legacy fallback: an older payload carries `hasDelta: true` with
    // neither an inline delta nor the precomputed flag. Classify
    // conservatively as phase 1 so the swap stays layout-stable.
    if (entry.hasCollapse === undefined && entry.hasDelta && !entry.delta) {
      return true;
    }
    return false;
  };

  // `'all'` mode walks every transform map on the variant.
  if (mode === 'all') {
    if ('transforms' in variant && variant.transforms) {
      if (checkEntry(variant.transforms[transformKey])) {
        return true;
      }
    }
    if ('extraFiles' in variant && variant.extraFiles) {
      for (const file of Object.values(variant.extraFiles)) {
        if (file && typeof file === 'object' && 'transforms' in file && file.transforms) {
          if (checkEntry(file.transforms[transformKey])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // `'selected'` / `'focus'` consult only the chosen file's transforms.
  // Main file is identified by `variant.fileName`; everything else is
  // looked up under `extraFiles`. `selectedFileName` is guaranteed to
  // be defined here (the default above falls back to `variant.fileName`).
  if (selectedFileName === undefined) {
    return false;
  }
  if ('fileName' in variant && selectedFileName === variant.fileName) {
    if ('transforms' in variant && variant.transforms) {
      return checkEntry(variant.transforms[transformKey]);
    }
    return false;
  }
  if ('extraFiles' in variant && variant.extraFiles) {
    const file = variant.extraFiles[selectedFileName];
    if (file && typeof file === 'object' && 'transforms' in file && file.transforms) {
      return checkEntry(file.transforms[transformKey]);
    }
  }
  return false;
}

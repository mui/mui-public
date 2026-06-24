// The transform-application runtime, split out of `useCodeUtils` so the heavy
// `applyCodeTransform` path (which statically pulls `jsondiffpatch`) loads only
// when a block actually applies a transform. `useTransformManagement` reaches it
// through the `transformEngineLoader` accessor on `CodeContext` (the eager
// `CodeProvider` bundles it; `CodeProviderLazy` dynamic-imports it), with a
// built-in fallback so transforms still work without a provider. The pure,
// manifest-only transform helpers stay in `useCodeUtils` so read-only / no-transform
// blocks never pull this chunk.

// Import the transform core (which takes its hast helpers injected) rather than
// the `applyCodeTransform` wrapper that binds them, so this dynamic engine chunk
// never statically pulls `decodeHastSource` / `frameFallbackFromSpans` (and
// their `hastDecompress` dependency). The helpers are threaded in from the
// always-loaded `useCode` shell, which already has them, so they stay counted
// there instead of being hoisted into their own chunks.
import { applyCodeTransformWithComments } from '../pipeline/loadIsomorphicCodeVariant/applyCodeTransformWithComments';
import type { TransformRuntimeDeps } from '../pipeline/loadIsomorphicCodeVariant/applyCodeTransformWithComments';
import type {
  VariantSource,
  VariantCode,
  Transforms,
  SourceComments,
  Fallbacks,
} from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import type { TransformedFile, TransformedFiles } from './useCodeUtils';

export type { TransformRuntimeDeps };

/**
 * Function signature of {@link createTransformedFiles}. Used by the
 * `transformEngineLoader` accessor and `useTransformManagement` so they can
 * reference the engine without statically importing this (heavy) module.
 *
 * `deps` (the decoder + frame-fallback helper) is injected by the caller (the
 * `useCode` shell already loads them) so this engine chunk doesn't statically
 * depend on them.
 */
export type CreateTransformedFiles = (
  selectedVariant: VariantCode | null,
  selectedTransform: string | null,
  deps: TransformRuntimeDeps,
  fallbacks?: Fallbacks,
) => TransformedFiles | undefined;

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
  deps: TransformRuntimeDeps,
  comments?: SourceComments,
  fallback?: FallbackNode[],
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
    const result = applyCodeTransformWithComments(
      source,
      transforms,
      selectedTransform,
      deps,
      comments,
      fallback,
    );
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
  // Hast helpers injected by the caller (the `useCode` shell), so this engine
  // chunk never statically imports them. See the module comment.
  deps: TransformRuntimeDeps,
  // Per-file DEFLATE dictionaries hoisted from a `ContentLoading` component.
  // A file's fallback may live here (hoisted) instead of on the variant
  // (stripped) — applying a transform must decode `hastCompressed`, so resolve
  // from both, preferring the hoisted copy.
  fallbacks?: Fallbacks,
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
      deps,
      selectedVariant.comments,
      (selectedVariant.fileName ? fallbacks?.[selectedVariant.fileName] : undefined) ??
        selectedVariant.fallback,
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
            deps,
            fileComments,
            fallbacks?.[extraFileName] ??
              (typeof fileData === 'object' ? fileData.fallback : undefined),
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

import { stringOrHastToJsx } from '../pipeline/hastUtils';
import { applyTransform } from '../CodeHighlighter/applyTransform';
import type { VariantSource, VariantCode, Code } from '../CodeHighlighter/types';

type Source = VariantSource;

interface TransformedFile {
  name: string;
  originalName: string;
  source: Source;
  component: React.ReactNode;
}

interface TransformedFilesResult {
  files: TransformedFile[];
  filenameMap: { [originalName: string]: string };
}

/**
 * Pure function to get available transforms from effective code data.
 * Only includes transforms that have actual deltas (file changes), not just filename changes.
 *
 * @param effectiveCode - The effective code object containing all variants
 * @param selectedVariantKey - The currently selected variant key
 * @returns Array of available transform keys that have deltas
 */
export function getAvailableTransforms(effectiveCode: Code, selectedVariantKey: string): string[] {
  const transforms = new Set<string>();

  if (effectiveCode && selectedVariantKey) {
    const variantCode = effectiveCode[selectedVariantKey];
    if (variantCode && typeof variantCode === 'object') {
      // Check main variant transforms
      if ('transforms' in variantCode && variantCode.transforms) {
        Object.keys(variantCode.transforms).forEach((transformKey) => {
          const transformData = variantCode.transforms![transformKey];
          // Only include transforms that have actual deltas (file changes)
          // Check if delta exists and is not empty
          if (transformData && typeof transformData === 'object' && 'delta' in transformData) {
            const delta = transformData.delta;
            // Check if delta has meaningful content (not just an empty object)
            const hasContent = delta && typeof delta === 'object' && Object.keys(delta).length > 0;
            if (hasContent) {
              transforms.add(transformKey);
            }
          }
        });
      }

      // Check extraFiles for transforms with deltas
      if ('extraFiles' in variantCode && variantCode.extraFiles) {
        Object.values(variantCode.extraFiles).forEach((fileData) => {
          if (
            fileData &&
            typeof fileData === 'object' &&
            'transforms' in fileData &&
            fileData.transforms
          ) {
            Object.keys(fileData.transforms).forEach((transformKey) => {
              const transformData = fileData.transforms![transformKey];
              // Only include transforms that have actual deltas (file changes)
              // Check if delta exists and is not empty
              if (transformData && typeof transformData === 'object' && 'delta' in transformData) {
                const delta = transformData.delta;
                // Check if delta has meaningful content (not just an empty object)
                const hasContent =
                  delta && typeof delta === 'object' && Object.keys(delta).length > 0;
                if (hasContent) {
                  transforms.add(transformKey);
                }
              }
            });
          }
        });
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
 * @returns Object with transformed source and name
 */
export function applyTransformToSource(
  source: any,
  fileName: string,
  transforms: any,
  selectedTransform: string,
): { transformedSource: Source; transformedName: string } {
  if (!transforms?.[selectedTransform]) {
    return { transformedSource: source, transformedName: fileName };
  }

  try {
    // Get transform data
    const transformData = transforms[selectedTransform];
    if (!transformData || typeof transformData !== 'object' || !('delta' in transformData)) {
      return { transformedSource: source, transformedName: fileName };
    }

    // Check if delta has meaningful content
    const delta = transformData.delta;
    const hasContent = delta && typeof delta === 'object' && Object.keys(delta).length > 0;
    if (!hasContent) {
      return { transformedSource: source, transformedName: fileName };
    }

    // Apply transform
    const result = applyTransform(source as Source, transforms, selectedTransform);
    const transformedName = transformData.fileName || fileName;

    return { transformedSource: result, transformedName };
  } catch (error) {
    console.error(`Transform failed for ${fileName}:`, error);
    return { transformedSource: source, transformedName: fileName };
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
  shouldHighlight: boolean,
): TransformedFilesResult | undefined {
  // Only create transformed files when there's actually a transform selected
  if (!selectedVariant || !selectedTransform) {
    return undefined;
  }

  const files: TransformedFile[] = [];
  const filenameMap: { [originalName: string]: string } = {};

  // First, check if any file has a meaningful transform delta for the selected transform
  const variantTransforms =
    'transforms' in selectedVariant ? selectedVariant.transforms : undefined;

  let hasAnyMeaningfulTransform = false;

  // Check main file for meaningful transform
  if (selectedVariant.fileName && variantTransforms?.[selectedTransform]?.delta) {
    const delta = variantTransforms[selectedTransform].delta;
    if (delta && Object.keys(delta).length > 0) {
      hasAnyMeaningfulTransform = true;
    }
  }

  // Check extraFiles for meaningful transforms
  if (!hasAnyMeaningfulTransform && selectedVariant.extraFiles) {
    Object.values(selectedVariant.extraFiles).forEach((fileData) => {
      if (fileData && typeof fileData === 'object' && 'transforms' in fileData) {
        const transformData = fileData.transforms?.[selectedTransform];
        if (transformData?.delta && Object.keys(transformData.delta).length > 0) {
          hasAnyMeaningfulTransform = true;
        }
      }
    });
  }

  // If no file has a meaningful transform, return empty result
  if (!hasAnyMeaningfulTransform) {
    return { files: [], filenameMap: {} };
  }

  // Process main file if we have a fileName
  if (selectedVariant.fileName) {
    const { transformedSource: mainSource, transformedName: mainName } = applyTransformToSource(
      selectedVariant.source,
      selectedVariant.fileName,
      variantTransforms,
      selectedTransform,
    );

    const fileName = selectedVariant.fileName;
    filenameMap[fileName] = mainName;
    files.push({
      name: mainName,
      originalName: fileName,
      source: mainSource as Source,
      component: stringOrHastToJsx(mainSource as Source, shouldHighlight),
    });
  }

  // Process extra files
  if (selectedVariant.extraFiles) {
    Object.entries(selectedVariant.extraFiles).forEach(([extraFileName, fileData]) => {
      let source: any;
      let transforms: any;

      // Handle different extraFile structures
      if (typeof fileData === 'string') {
        source = fileData;
        transforms = undefined; // Don't inherit variant transforms for simple string files
      } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
        source = fileData.source;
        transforms = fileData.transforms; // Only use explicit transforms for this file
      } else {
        return; // Skip invalid entries
      }

      // Apply transforms if available, otherwise use original source
      let transformedSource = source;
      let transformedName = extraFileName;

      if (transforms?.[selectedTransform]) {
        try {
          const transformData = transforms[selectedTransform];
          if (transformData && typeof transformData === 'object' && 'delta' in transformData) {
            // Only apply transform if there's a meaningful delta
            const hasTransformDelta =
              transformData.delta && Object.keys(transformData.delta).length > 0;
            if (hasTransformDelta) {
              transformedSource = applyTransform(source as Source, transforms, selectedTransform);
              transformedName = transformData.fileName || extraFileName;
            }
          }
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
          source: transformedSource as Source,
          component: stringOrHastToJsx(transformedSource as Source, shouldHighlight),
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

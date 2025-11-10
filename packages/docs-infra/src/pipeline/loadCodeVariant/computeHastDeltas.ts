import { toText } from 'hast-util-to-text';
import type { Code, ParseSource } from '../../CodeHighlighter/types';
import { diffHast } from './diffHast';

/**
 * Pure function to identify which variants need transformation.
 * Returns entries of variants that have transforms requiring processing.
 */
export function getVariantsToTransform(parsedCode: Code): Array<[string, any]> {
  return Object.entries(parsedCode).filter(([, variantCode]) => {
    if (!variantCode || typeof variantCode !== 'object') {
      return false;
    }

    // Check if main source has transforms and needs processing
    const mainSourceNeedsTransform =
      variantCode.transforms &&
      variantCode.source &&
      typeof variantCode.source !== 'string' &&
      !('hastJson' in variantCode.source);

    // Check if any extraFiles have transforms and need processing
    const extraFilesNeedTransform = variantCode.extraFiles
      ? Object.values(variantCode.extraFiles).some(
          (fileContent) =>
            typeof fileContent === 'object' &&
            fileContent &&
            fileContent.transforms &&
            fileContent.source &&
            typeof fileContent.source !== 'string' &&
            !('hastJson' in fileContent.source),
        )
      : false;

    return mainSourceNeedsTransform || extraFilesNeedTransform;
  });
}

/**
 * Pure function to get available transforms from a specific variant.
 * Only includes transforms that have actual deltas (file changes), not just filename changes.
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

  // Check main variant transforms
  if (currentVariant.transforms) {
    Object.keys(currentVariant.transforms).forEach((transformKey) => {
      const transformData = currentVariant.transforms![transformKey];
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
  if (currentVariant.extraFiles) {
    Object.values(currentVariant.extraFiles).forEach((fileData) => {
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
            const hasContent = delta && typeof delta === 'object' && Object.keys(delta).length > 0;
            if (hasContent) {
              transforms.add(transformKey);
            }
          }
        });
      }
    });
  }

  return Array.from(transforms);
}

/**
 * Pure async function to transform a single variant's code and extraFiles.
 * Returns the transformed variant or the original if transformation fails.
 */
export async function computeVariantDeltas(
  variant: string,
  variantCode: any,
  parseSource: ParseSource,
): Promise<any> {
  // Type guard
  if (typeof variantCode !== 'object' || !variantCode) {
    return variantCode;
  }

  let mainTransformResult;
  let transformedExtraFiles;

  // Process main source transforms if applicable
  if (
    variantCode.transforms &&
    variantCode.source &&
    typeof variantCode.source !== 'string' &&
    !('hastJson' in variantCode.source)
  ) {
    const hastNodes = variantCode.source;
    const sourceString = toText(hastNodes, { whitespace: 'pre' });

    mainTransformResult = await diffHast(
      sourceString,
      hastNodes,
      variant, // fileName
      variantCode.transforms,
      parseSource,
    );
  }

  // Process extraFiles transforms if applicable
  if (variantCode.extraFiles) {
    transformedExtraFiles = await Promise.all(
      Object.entries(variantCode.extraFiles).map(async ([fileName, fileContent]: [string, any]) => {
        if (
          typeof fileContent === 'object' &&
          fileContent &&
          fileContent.transforms &&
          fileContent.source &&
          typeof fileContent.source !== 'string' &&
          !('hastJson' in fileContent.source)
        ) {
          try {
            const extraHastNodes = fileContent.source;
            const extraSourceString = toText(extraHastNodes, { whitespace: 'pre' });

            const extraTransformResult = await diffHast(
              extraSourceString,
              extraHastNodes,
              fileName,
              fileContent.transforms,
              parseSource,
            );

            return [
              fileName,
              {
                ...fileContent,
                transforms: extraTransformResult,
              },
            ];
          } catch (error) {
            console.error(`Failed to transform extraFile ${fileName}:`, error);
            return [fileName, fileContent];
          }
        }
        return [fileName, fileContent];
      }),
    ).then((entries) => Object.fromEntries(entries));
  }

  // Update the variant with the computed results
  const transformedVariant = {
    ...variantCode,
    ...(mainTransformResult && { transforms: mainTransformResult }),
    ...(transformedExtraFiles && { extraFiles: transformedExtraFiles }),
  };

  return transformedVariant;
}

/**
 * Computes transform deltas for all variants in the parsed code.
 * This function generates the transformation data that can be applied later.
 *
 * @param parsedCode - The parsed code object containing variants
 * @param parseSource - The parser function to parse source strings
 * @returns A promise that resolves to the code with computed transforms
 */
export async function computeHastDeltas(parsedCode: Code, parseSource: ParseSource) {
  const variantsToTransform = getVariantsToTransform(parsedCode);

  if (variantsToTransform.length === 0) {
    // No variants need transformation
    return parsedCode;
  }

  // Process transformations for all variants
  const results = await Promise.all(
    variantsToTransform.map(async ([variant, variantCode]) => {
      try {
        const transformedVariant = await computeVariantDeltas(variant, variantCode, parseSource);
        return { variant, transformedVariant };
      } catch (error) {
        // Keep original variant if transformation fails
        console.error(`Failed to transform variant ${variant}:`, error);
        return { variant, transformedVariant: variantCode };
      }
    }),
  );

  // Apply the transformations to create the enhanced code
  const enhancedCode = { ...parsedCode };

  for (const { variant, transformedVariant } of results) {
    enhancedCode[variant] = transformedVariant;
  }

  return enhancedCode;
}

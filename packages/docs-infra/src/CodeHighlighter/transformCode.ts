import { toText } from 'hast-util-to-text';
import type { Code, ParseSource } from './types';
import { transformParsedSource } from './transformParsedSource';

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
 */
export function getAvailableTransforms(
  parsedCode: Code | undefined,
  variantName: string,
): string[] {
  const currentVariant = parsedCode?.[variantName];

  if (currentVariant && typeof currentVariant === 'object' && currentVariant.transforms) {
    return Object.keys(currentVariant.transforms);
  }

  return [];
}

/**
 * Pure async function to transform a single variant's code and extraFiles.
 * Returns the transformed variant or the original if transformation fails.
 */
export async function transformVariant(
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

    mainTransformResult = await transformParsedSource(
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

            const extraTransformResult = await transformParsedSource(
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
 * Pure async function to apply transformations to all variants that need them.
 * Returns the enhanced code with computed transforms.
 */
export async function applyTransforms(parsedCode: Code, parseSource: ParseSource): Promise<Code> {
  const variantsToTransform = getVariantsToTransform(parsedCode);

  if (variantsToTransform.length === 0) {
    // No variants need transformation
    return parsedCode;
  }

  // Process transformations for all variants
  const results = await Promise.all(
    variantsToTransform.map(async ([variant, variantCode]) => {
      try {
        const transformedVariant = await transformVariant(variant, variantCode, parseSource);
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

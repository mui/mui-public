import { toText } from 'hast-util-to-text';
import type { Code, HastRoot, ParseSource, Transforms } from '../../CodeHighlighter/types';
import { diffHast } from './diffHast';

/**
 * Splits the result of `diffHast` (which always carries deltas) into the
 * variant-level `manifest` and the `embedded` map that should ride inside
 * `source.data.transforms`. Entries with an empty delta are dropped.
 *
 * Returns `undefined` when no entry survived — callers should treat that as
 * "no transforms to record".
 */
function splitTransformsForEmbed(
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
 * along inside the (possibly later compressed) hast payload and stay out of
 * the variant-level wire shape that ends up in HTML / module graph.
 */
function embedTransformsInRoot(root: HastRoot, embedded: Transforms): void {
  root.data = { ...(root.data || {}), transforms: embedded };
}

/**
 * Pure function to identify which variants need transformation.
 * Returns entries of variants that have transforms requiring processing.
 */
/**
 * Pure function to identify which variants need transformation.
 * Returns entries of variants that have transforms requiring processing.
 *
 * Skips variants whose transforms have already been embedded into
 * `source.data.transforms` (i.e. already processed). Also requires at least
 * one transform entry to still carry a `delta` — manifest-only entries
 * (with `delta` stripped after embedding) are ignored.
 */
export function getVariantsToTransform(parsedCode: Code): Array<[string, any]> {
  const hasDeltaEntries = (transforms: Record<string, any> | undefined): boolean =>
    !!transforms &&
    Object.values(transforms).some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        'delta' in entry &&
        entry.delta &&
        typeof entry.delta === 'object' &&
        Object.keys(entry.delta).length > 0,
    );

  const sourceIsUnembeddedHast = (source: any): boolean =>
    !!source &&
    typeof source === 'object' &&
    !('hastJson' in source) &&
    !('hastCompressed' in source) &&
    !(source.data && source.data.transforms);

  return Object.entries(parsedCode).filter(([, variantCode]) => {
    if (!variantCode || typeof variantCode !== 'object') {
      return false;
    }

    const mainSourceNeedsTransform =
      hasDeltaEntries(variantCode.transforms) &&
      typeof variantCode.source !== 'string' &&
      sourceIsUnembeddedHast(variantCode.source);

    const extraFilesNeedTransform = variantCode.extraFiles
      ? Object.values(variantCode.extraFiles).some(
          (fileContent) =>
            typeof fileContent === 'object' &&
            fileContent &&
            hasDeltaEntries(fileContent.transforms) &&
            typeof fileContent.source !== 'string' &&
            sourceIsUnembeddedHast(fileContent.source),
        )
      : false;

    return mainSourceNeedsTransform || extraFilesNeedTransform;
  });
}

/**
 * Pure function to get available transforms from a specific variant.
 *
 * Variant-level `transforms` is a manifest produced by `splitTransformsForEmbed`
 * (or by the legacy `Transforms` shape with deltas, for back-compat). Either
 * way, every key present here is guaranteed to have a non-empty delta inside
 * `source.data.transforms`, so we just enumerate the keys.
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

  if (currentVariant.transforms) {
    for (const transformKey of Object.keys(currentVariant.transforms)) {
      transforms.add(transformKey);
    }
  }

  if (currentVariant.extraFiles) {
    for (const fileData of Object.values(currentVariant.extraFiles)) {
      if (
        fileData &&
        typeof fileData === 'object' &&
        'transforms' in fileData &&
        fileData.transforms
      ) {
        for (const transformKey of Object.keys(fileData.transforms)) {
          transforms.add(transformKey);
        }
      }
    }
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
    !('hastJson' in variantCode.source) &&
    !('hastCompressed' in variantCode.source)
  ) {
    const hastNodes = variantCode.source as HastRoot;
    const sourceString = toText(hastNodes, { whitespace: 'pre' });

    const computed = await diffHast(
      sourceString,
      hastNodes,
      variant, // fileName
      variantCode.transforms,
      parseSource,
    );

    const split = splitTransformsForEmbed(computed);
    if (split) {
      embedTransformsInRoot(hastNodes, split.embedded);
      mainTransformResult = split.manifest;
    } else {
      mainTransformResult = undefined;
    }
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
          !('hastJson' in fileContent.source) &&
          !('hastCompressed' in fileContent.source)
        ) {
          try {
            const extraHastNodes = fileContent.source as HastRoot;
            const extraSourceString = toText(extraHastNodes, { whitespace: 'pre' });

            const computedExtra = await diffHast(
              extraSourceString,
              extraHastNodes,
              fileName,
              fileContent.transforms,
              parseSource,
            );

            const splitExtra = splitTransformsForEmbed(computedExtra);
            if (splitExtra) {
              embedTransformsInRoot(extraHastNodes, splitExtra.embedded);
              return [
                fileName,
                {
                  ...fileContent,
                  transforms: splitExtra.manifest,
                },
              ];
            }
            // No surviving entries — drop transforms from the extra file.
            const { transforms: droppedTransforms, ...rest } = fileContent;
            return [fileName, rest];
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
    ...(mainTransformResult !== undefined && { transforms: mainTransformResult }),
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

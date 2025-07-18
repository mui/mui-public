import * as React from 'react';
import { Code, VariantCode } from './types';
import { transformParsedSource } from './transformParsedSource';
import { useCodeContext } from '../CodeProvider/CodeContext';

/**
 * Hook to transform all parsed code by adding computed transform deltas
 * Assumes input code is clean (without computed transforms) from useHighlighted
 */
export function useTransformer({
  code,
  readyForContent,
  variants,
  setCode,
}: {
  code?: Code;
  readyForContent: boolean;
  variants: string[];
  setCode: React.Dispatch<React.SetStateAction<Code | undefined>>;
}) {
  const { parseSource } = useCodeContext();

  React.useEffect(() => {
    if (!readyForContent || !code) {
      return;
    }

    // Check if any variants have transforms and parsed (non-string) sources that need transformation
    const hasVariantsNeedingTransformation = variants.some((name) => {
      const codeVariant = code[name];
      return (
        codeVariant &&
        typeof codeVariant !== 'string' &&
        codeVariant.transforms &&
        Object.keys(codeVariant.transforms).length > 0 &&
        codeVariant.source &&
        typeof codeVariant.source !== 'string' // Only transform parsed sources
      );
    });

    if (!hasVariantsNeedingTransformation) {
      return;
    }

    // Transform variants that need it
    const transformVariantsAsync = async () => {
      if (!parseSource) {
        throw new Error('parseSource is required for transforming parsed sources');
      }

      const transformedVariants: Code = {};

      // Collect variants that need transformation
      const variantsToTransform: Array<{
        variantName: string;
        variantCode: VariantCode;
      }> = [];

      // First pass: separate variants that need transformation from those that don't
      for (const variantName of variants) {
        const codeVariant = code[variantName];
        if (!codeVariant || typeof codeVariant === 'string') {
          transformedVariants[variantName] = codeVariant;
          continue;
        }

        // Type guard: at this point codeVariant is VariantCode
        const variantCode = codeVariant as VariantCode;

        if (
          !variantCode.transforms ||
          !variantCode.source ||
          typeof variantCode.source === 'string'
        ) {
          transformedVariants[variantName] = variantCode;
          continue;
        }

        if (Object.keys(variantCode.transforms).length === 0) {
          transformedVariants[variantName] = variantCode;
          continue;
        }

        // This variant needs transformation
        variantsToTransform.push({ variantName, variantCode });
      }

      // Transform all variants in parallel
      if (variantsToTransform.length > 0) {
        const transformPromises = variantsToTransform.map(async ({ variantName, variantCode }) => {
          try {
            // Convert parsed source to the format expected by transformParsedSource
            let sourceString: string;
            let parsedSource: any;

            if (typeof variantCode.source === 'string') {
              sourceString = variantCode.source;
              parsedSource = variantCode.source;
            } else if (variantCode.source && 'hastJson' in variantCode.source) {
              sourceString = variantCode.source.hastJson;
              parsedSource = JSON.parse(variantCode.source.hastJson);
            } else {
              sourceString = JSON.stringify(variantCode.source);
              parsedSource = variantCode.source;
            }

            // Use transformParsedSource to generate transform deltas
            const transformedTransforms = await transformParsedSource(
              sourceString,
              parsedSource,
              variantCode.fileName || 'index.js',
              variantCode.transforms!,
              parseSource,
            );

            return {
              variantName,
              transformedVariant: {
                ...variantCode,
                transforms: transformedTransforms,
              },
            };
          } catch (error) {
            console.error(`Failed to transform variant "${variantName}":`, error);
            // Keep original variant on error
            return {
              variantName,
              transformedVariant: variantCode,
            };
          }
        });

        const transformResults = await Promise.all(transformPromises);

        // Apply transformation results
        for (const { variantName, transformedVariant } of transformResults) {
          transformedVariants[variantName] = transformedVariant;
        }
      }

      // Update the code with computed transforms
      setCode(transformedVariants);
    };

    transformVariantsAsync().catch((error) => {
      console.error('Failed to transform variants:', error);
    });
  }, [code, readyForContent, variants, setCode, parseSource]);

  return {}; // No need to return anything
}

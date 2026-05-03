import type { Root as HastRoot } from 'hast';
import type { Code, SourceEnhancers, HastRoot as TypedHastRoot } from '../../CodeHighlighter/types';

/**
 * Helper to check if a source is a HAST root (already parsed)
 */
function isHastRoot(source: unknown): source is HastRoot {
  return (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    (source as HastRoot).type === 'root'
  );
}

/**
 * Async function to enhance parsed code variants and their extraFiles.
 * Applies sourceEnhancers to HAST nodes, using comments stored in the variant.
 */
export async function enhanceCode(code: Code, sourceEnhancers: SourceEnhancers): Promise<Code> {
  if (!sourceEnhancers || sourceEnhancers.length === 0) {
    return code;
  }

  /**
   * Helper to apply enhancers sequentially to a HAST root
   */
  async function applyEnhancers(
    source: TypedHastRoot,
    comments: Record<number, string[]> | undefined,
    fileName: string,
  ): Promise<TypedHastRoot> {
    return sourceEnhancers.reduce(async (accPromise, enhancer) => {
      const acc = await accPromise;
      return enhancer(acc, comments, fileName);
    }, Promise.resolve(source));
  }

  /**
   * Helper to enhance a single variant
   */
  async function enhanceVariant(
    variantCode: NonNullable<Code[string]>,
  ): Promise<NonNullable<Code[string]>> {
    if (typeof variantCode === 'string') {
      return variantCode;
    }

    if (!variantCode.source || !isHastRoot(variantCode.source)) {
      return variantCode;
    }

    // Apply enhancers to the main source
    const fileName = variantCode.fileName || 'unknown';
    const enhancedSource = await applyEnhancers(
      variantCode.source as TypedHastRoot,
      variantCode.comments,
      fileName,
    );

    // Also enhance extraFiles if they have HAST sources
    let enhancedExtraFiles = variantCode.extraFiles;
    if (variantCode.extraFiles) {
      const extraFileEntries = await Promise.all(
        Object.entries(variantCode.extraFiles).map(async ([extraFileName, fileContent]) => {
          if (typeof fileContent === 'string') {
            return [extraFileName, fileContent]; // Keep string as-is
          }
          if (fileContent && typeof fileContent === 'object' && isHastRoot(fileContent.source)) {
            // Apply enhancers to this extra file's source
            const enhancedExtraSource = await applyEnhancers(
              fileContent.source as TypedHastRoot,
              fileContent.comments,
              extraFileName,
            );

            return [
              extraFileName,
              {
                ...fileContent,
                source: enhancedExtraSource,
                // Clear comments after enhancing since they've been consumed
                comments: undefined,
              },
            ];
          }
          return [extraFileName, fileContent]; // Keep as-is for other cases
        }),
      );

      enhancedExtraFiles = Object.fromEntries(extraFileEntries);
    }

    return {
      ...variantCode,
      source: enhancedSource,
      extraFiles: enhancedExtraFiles,
      // Clear comments after enhancing since they've been consumed
      comments: undefined,
    };
  }

  // Process all variants in parallel
  const entries = Object.entries(code);
  const enhancedEntries = await Promise.all(
    entries.map(async ([variant, variantCode]) => {
      if (!variantCode) {
        return [variant, variantCode];
      }
      const enhanced = await enhanceVariant(variantCode);
      return [variant, enhanced];
    }),
  );

  return Object.fromEntries(enhancedEntries);
}

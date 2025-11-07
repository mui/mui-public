import { Code, VariantSource } from '../../CodeHighlighter/types';

/**
 * Checks if a code source is fully loaded and ready for rendering.
 *
 * @param code - Code object with source property
 * @param needsHighlight - Whether the source needs to be syntax highlighted (not just a string)
 * @returns True if the source is loaded and meets highlighting requirements
 */
function isSourceLoaded(code: { source?: VariantSource }, needsHighlight?: boolean): boolean {
  if (!code.source) {
    return false;
  }

  if (typeof code.source === 'string' && needsHighlight) {
    return false;
  }

  // if it's a hast node or hastJson, we assume it's loaded
  return true;
}

/**
 * Determines if all code variants are fully loaded and ready to render the complete content component.
 *
 * This function validates that we have all necessary data to transition from fallback/loading state
 * to the full interactive code highlighter. It checks both main files and extra files for all variants.
 *
 * Used primarily to determine when to show the full Content component instead of ContentLoading
 * fallback, ensuring a smooth user experience without rendering errors.
 *
 * @param variants - Array of variant names that must all be ready (e.g., ['javascript', 'typescript'])
 * @param code - The code object containing variant data
 * @param needsHighlight - Whether all sources need to be syntax highlighted (hast nodes, not strings)
 * @returns True if all variants and their files are loaded and ready for full rendering
 *
 * @example
 * ```typescript
 * const readyForContent = hasAllVariants(['js', 'ts'], codeData, true);
 *
 * if (readyForContent) {
 *   return <Content {...contentProps} />; // Full interactive component
 * } else {
 *   return <ContentLoading {...loadingProps} />; // Fallback state
 * }
 * ```
 */
export function hasAllVariants(variants: string[], code: Code, needsHighlight?: boolean) {
  return variants.every((variant) => {
    const codeVariant = code?.[variant];
    if (
      !codeVariant ||
      typeof codeVariant === 'string' ||
      !isSourceLoaded(codeVariant, needsHighlight)
    ) {
      return false;
    }

    const extraFiles = codeVariant.extraFiles;
    if (!extraFiles) {
      return true;
    }

    return Object.keys(extraFiles).every((file) => {
      const extraFile = extraFiles[file];
      if (
        !extraFile ||
        typeof extraFile === 'string' ||
        !isSourceLoaded(extraFile, needsHighlight)
      ) {
        return false;
      }

      return true;
    });
  });
}

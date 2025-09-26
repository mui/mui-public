import { hasAllVariants } from './hasAllVariants';
import { Code, VariantExtraFiles, VariantSource } from './types';

/**
 * Type guard function that determines if we have sufficient data to render a code highlighter
 * component immediately, or if we need to start loading data first.
 *
 * This function acts as a validation layer to ensure we have the minimal required data
 * to render either a fallback state or the actual code content, helping to prevent
 * rendering errors and provide better user experience.
 *
 * ## Usage Contexts
 *
 * This function is used in two main scenarios:
 *
 * 1. **Server-side rendering (CodeHighlighter)**: Determines if we can render with initial
 *    source content immediately, or if we need to load fallback data via `CodeInitialSourceLoader`
 *
 * 2. **Client-side hydration (CodeHighlighterClient)**: Within `useInitialData` hook to determine
 *    if we should trigger loading effects or if we can render with available data
 *
 * ## Decision Flow
 *
 * The function checks data availability in this order:
 * 1. Code object exists and contains the requested variant
 * 2. All required variants are available (if `needsAllVariants` is true)
 * 3. Requested file exists (main file or in extraFiles)
 * 4. All extra files are loaded (if `needsAllFiles` is true)
 * 5. Source content is properly highlighted (if `needsHighlight` is true)
 *
 * ## Synchronous vs Asynchronous Behavior
 *
 * This function operates **synchronously** and only validates existing data - it never triggers
 * any loading operations. This design is crucial for performance and rendering strategies:
 *
 * - **Synchronous validation** allows immediate decisions about rendering paths without async overhead
 * - **Enables build-time optimization**: When code is precomputed (e.g., via build-time processing),
 *   this function can immediately return `initialData`, avoiding async components entirely
 * - **Separates concerns**: Data validation is separate from data loading, making the codebase
 *   more predictable and easier to reason about
 *
 * When `initialData: false` is returned, the calling component is responsible for initiating
 * asynchronous loading operations (e.g., `loadFallbackCode`, `CodeInitialSourceLoader`).
 *
 * @param variants - Array of all available variant names for this code block (e.g., ['javascript', 'typescript'])
 * @param variant - The specific variant we want to display (must exist in variants array)
 * @param code - The code object containing all variant data (may be undefined if not loaded)
 * @param fileName - Optional specific file to display. Resolution logic:
 *   - When it matches `variantCode.fileName`, uses the main variant source
 *   - When it doesn't match, looks for the file in `variantCode.extraFiles`
 *   - When undefined, defaults to the main file of the variant
 * @param needsHighlight - Whether the code needs to be syntax highlighted (source must be highlighted object, not string)
 * @param needsAllFiles - Whether all extra files must be loaded before rendering (checks that all extraFiles have source content)
 * @param needsAllVariants - Whether all variants must be available before rendering (validates using hasAllVariants)
 *
 * @returns Object with either:
 * - `initialData: false` with a `reason` string explaining why data is insufficient for rendering
 * - `initialData: object` containing the validated data ready for immediate rendering, including:
 *   - `code`: The full code object
 *   - `initialFilename`: The resolved filename (may be undefined if variant has no fileName)
 *   - `initialSource`: The source content for the requested file
 *   - `initialExtraFiles`: Extra files associated with the variant (if any)
 *
 * @example
 * ```typescript
 * // Server-side: Check if we can render with initial source or need to load fallback
 * const { initialData, reason } = maybeInitialData(
 *   variants,
 *   initialKey,
 *   code || props.precompute,
 *   undefined,
 *   highlightAfter === 'init',
 *   props.fallbackUsesExtraFiles,
 *   props.fallbackUsesAllVariants,
 * );
 *
 * if (!initialData) {
 *   // Need to load fallback data
 *   return <CodeInitialSourceLoader {...props} />;
 * }
 *
 * // Client-side: Check if we need to trigger loading effects
 * const { initialData, reason } = React.useMemo(() =>
 *   maybeInitialData(
 *     variants,
 *     variantName,
 *     code,
 *     fileName,
 *     highlightAfter === 'init',
 *     fallbackUsesExtraFiles,
 *     fallbackUsesAllVariants,
 *   ), [dependencies]);
 *
 * React.useEffect(() => {
 *   if (initialData || isControlled) {
 *     return; // No loading needed
 *   }
 *   // Trigger loadFallbackCode...
 * }, [initialData, reason, ...]);
 * ```
 */
export function maybeInitialData(
  variants: string[],
  variant: string,
  code?: Code,
  fileName?: string,
  needsHighlight = false,
  needsAllFiles = false,
  needsAllVariants = false,
): {
  initialData:
    | false
    | {
        code: Code;
        initialFilename: string | undefined;
        initialSource: VariantSource;
        initialExtraFiles?: VariantExtraFiles;
      };
  reason?: string;
} {
  if (!code) {
    return {
      initialData: false,
      reason: 'No code provided',
    };
  }

  if (needsAllVariants && !hasAllVariants(variants, code, needsHighlight)) {
    return {
      initialData: false,
      reason: 'Not all variants are available',
    };
  }

  const variantCode = code[variant];
  if (!variantCode || typeof variantCode === 'string') {
    return {
      initialData: false,
      reason: 'Variant code is not loaded yet',
    };
  }

  if (needsAllFiles) {
    if (!variantCode) {
      return {
        initialData: false,
        reason: 'Variant code not found',
      };
    }

    if (!variantCode.source) {
      return {
        initialData: false,
        reason: 'Variant source not found',
      };
    }

    if (
      variantCode.extraFiles &&
      !Object.keys(variantCode.extraFiles).every((file) => {
        const fileData = variantCode.extraFiles?.[file];
        return typeof fileData === 'object' && fileData?.source !== undefined;
      })
    ) {
      return {
        initialData: false,
        reason: 'Not all extra files are available',
      };
    }
  }

  // TODO, filename might need to be determined from filesOrder if provided?
  const initialFilename = fileName || variantCode.fileName;
  let fileSource: VariantSource | undefined;

  if (fileName && fileName !== variantCode.fileName) {
    const fileData = variantCode?.extraFiles?.[fileName];
    if (!fileData) {
      return {
        initialData: false,
        reason: `File not found in code`,
      };
    }

    if (typeof fileData === 'string') {
      // It's a URL, not actual source content
      return {
        initialData: false,
        reason: `File is not loaded yet`,
      };
    }

    fileSource = fileData.source;
  } else {
    fileSource = variantCode.source;
  }

  if (!fileSource) {
    return {
      initialData: false,
      reason: `File source not found`,
    };
  }

  if (needsHighlight && typeof fileSource === 'string') {
    return {
      initialData: false,
      reason: 'File needs highlighting',
    };
  }

  return {
    initialData: {
      code,
      initialFilename,
      initialSource: fileSource,
      initialExtraFiles: variantCode?.extraFiles,
    },
  };
}

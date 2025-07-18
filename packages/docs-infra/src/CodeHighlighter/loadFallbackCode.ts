import type {
  Code,
  VariantExtraFiles,
  ParseSource,
  LoadSource,
  LoadVariantMeta,
  VariantSource,
  LoadCodeMeta,
  VariantCode,
} from './types';
import { loadVariant, getFileNameFromUrl } from './loadVariant';

// Helper function to get the source for a specific filename from a variant
async function getFileSource(
  variant: VariantCode,
  requestedFilename: string | undefined,
  loadSource: LoadSource | undefined,
): Promise<{ source: VariantSource; filename: string }> {
  const filename = requestedFilename || variant.fileName;

  // If requesting the main file and we have its source
  if (filename === variant.fileName && variant.source !== undefined) {
    return { source: variant.source, filename };
  }

  // If requesting an extra file and we have its source
  if (filename !== variant.fileName && variant.extraFiles) {
    const extraFile = variant.extraFiles[filename];
    if (extraFile && typeof extraFile !== 'string' && extraFile.source !== undefined) {
      return { source: extraFile.source, filename };
    }

    // If we have the URL but not the source, we need to load it
    if (typeof extraFile === 'string' && loadSource) {
      const loadResult = await loadSource(extraFile);
      return { source: loadResult.source, filename };
    }

    if (extraFile && typeof extraFile !== 'string' && !extraFile.source && loadSource) {
      // This case shouldn't normally happen, but handle it anyway
      throw new Error(`Extra file ${filename} has no source or URL to load from`);
    }
  }

  throw new Error(`File ${filename} not found in variant or cannot be loaded`);
}

export type FallbackVariants = {
  code: Code;
  initialFilename: string;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
  allFileNames: string[];
};

export async function loadFallbackCode(
  url: string,
  initialVariant: string,
  loaded: Code | undefined,
  shouldHighlight?: boolean,
  fallbackUsesExtraFiles?: boolean,
  fallbackUsesAllVariants?: boolean,
  parseSource?: ParseSource,
  loadSource?: LoadSource,
  loadVariantMeta?: LoadVariantMeta,
  loadCodeMeta?: LoadCodeMeta,
  initialFilename?: string,
): Promise<FallbackVariants> {
  loaded = { ...loaded };

  // Step 1: Ensure we have the initial variant loaded
  let initial = loaded[initialVariant];
  if (!initial) {
    if (!loadCodeMeta) {
      throw new Error('"loadCodeMeta" function is required when initial variant is not provided');
    }

    try {
      loaded = await loadCodeMeta(url);
    } catch (error) {
      throw new Error(`Failed to load code from URL: ${url}. Error: ${JSON.stringify(error)}`);
    }

    initial = loaded[initialVariant];
    if (!initial) {
      throw new Error(`Initial variant "${initialVariant}" not found in loaded code.`);
    }
  }

  // Check if we can return early after loadCodeMeta
  if (
    typeof initial !== 'string' &&
    initial.allFilesListed &&
    !fallbackUsesExtraFiles &&
    !fallbackUsesAllVariants
  ) {
    // Collect all file names from the loaded code
    const allFileNames = new Set<string>();
    allFileNames.add(initial.fileName);
    if (initial.extraFiles) {
      Object.keys(initial.extraFiles).forEach((fileName) => allFileNames.add(fileName));
    }

    // Get the source for the requested filename (or main file if not specified)
    let fileSource: VariantSource;
    let actualFilename: string;

    try {
      const result = await getFileSource(initial, initialFilename, loadSource);
      fileSource = result.source;
      actualFilename = result.filename;
    } catch (error) {
      throw new Error(
        `Failed to get source for file ${initialFilename || initial.fileName} in variant ${initialVariant}: ${error}`,
      );
    }

    // If we need highlighting and have a string source, parse it
    if (shouldHighlight && typeof fileSource === 'string' && parseSource) {
      try {
        fileSource = await parseSource(fileSource, actualFilename);
      } catch (error) {
        throw new Error(
          `Failed to parse source for highlighting (variant: ${initialVariant}, file: ${actualFilename}): ${JSON.stringify(error)}`,
        );
      }
    }

    // Update the loaded code with any changes we made
    if (actualFilename === initial.fileName) {
      initial = { ...initial, source: fileSource };
      loaded = { ...loaded, [initialVariant]: initial };
    }

    // Early return - we have all the info we need
    return {
      code: loaded,
      initialFilename: actualFilename,
      initialSource: fileSource,
      initialExtraFiles: initial.extraFiles || {},
      allFileNames: Array.from(allFileNames),
    };
  }

  // Step 2: Try to get variant metadata quickly first
  if (typeof initial === 'string') {
    try {
      let quickVariant: VariantCode;

      if (loadVariantMeta) {
        // Use provided loadVariantMeta function
        quickVariant = await loadVariantMeta(initialVariant, initial);
      } else {
        // Create a basic variant using fallback logic
        quickVariant = {
          url: initial,
          fileName: getFileNameFromUrl(initial),
        };
      }

      loaded = { ...loaded, [initialVariant]: quickVariant };
      initial = quickVariant;

      // If we have all files listed and don't need extra file processing, we can optimize
      if (quickVariant.allFilesListed && !fallbackUsesExtraFiles && !fallbackUsesAllVariants) {
        // Collect all file names from the quick load
        const allFileNames = new Set<string>();
        allFileNames.add(quickVariant.fileName);
        if (quickVariant.extraFiles) {
          Object.keys(quickVariant.extraFiles).forEach((fileName) => allFileNames.add(fileName));
        }

        // Get the source for the requested filename (or main file if not specified)
        let fileSource: VariantSource;
        let actualFilename: string;

        try {
          const result = await getFileSource(quickVariant, initialFilename, loadSource);
          fileSource = result.source;
          actualFilename = result.filename;
        } catch (error) {
          throw new Error(
            `Failed to get source for file ${initialFilename || quickVariant.fileName} in variant ${initialVariant}: ${error}`,
          );
        }

        // If we need highlighting and have a string source, parse it
        if (shouldHighlight && typeof fileSource === 'string' && parseSource) {
          try {
            fileSource = await parseSource(fileSource, actualFilename);
          } catch (error) {
            throw new Error(
              `Failed to parse source for highlighting (variant: ${initialVariant}, file: ${actualFilename}): ${JSON.stringify(error)}`,
            );
          }
        }

        // Update the loaded code with any changes we made
        if (actualFilename === quickVariant.fileName) {
          initial = { ...quickVariant, source: fileSource };
          loaded = { ...loaded, [initialVariant]: initial };
        }

        // Early return - we have all the info we need
        return {
          code: loaded,
          initialFilename: actualFilename,
          initialSource: fileSource,
          initialExtraFiles: quickVariant.extraFiles || {},
          allFileNames: Array.from(allFileNames),
        };
      }
    } catch (error) {
      throw new Error(
        `Failed to load initial variant code (variant: ${initialVariant}, url: ${initial}): ${JSON.stringify(error)}`,
      );
    }
  }

  // Step 2b: Fall back to full loadVariant processing
  try {
    const { code: loadedVariant } = await loadVariant(
      url,
      initialVariant,
      initial,
      shouldHighlight ? parseSource : undefined,
      loadSource,
      loadVariantMeta,
      undefined, // sourceTransformers - skip transforms for fallback
      {
        disableTransforms: true, // Don't apply transforms for fallback
        disableParsing: !shouldHighlight, // Only parse if highlighting is needed
      },
    );

    // Update the loaded code with the processed variant
    loaded = { ...loaded, [initialVariant]: loadedVariant };
    initial = loadedVariant;
  } catch (error) {
    throw new Error(
      `Failed to load initial variant using loadVariant (variant: ${initialVariant}, url: ${url}): ${JSON.stringify(error)}`,
    );
  }

  // Step 3: Collect all file names
  const allFileNames = new Set<string>();
  allFileNames.add(initial.fileName);

  // Add extra files from the initial variant
  if (initial.extraFiles) {
    Object.keys(initial.extraFiles).forEach((fileName) => allFileNames.add(fileName));
  }

  // Step 4: Handle fallbackUsesAllVariants - load all variants to get all possible files
  if (fallbackUsesAllVariants) {
    const variantPromises = Object.entries(loaded).map(async ([variantName, variant]) => {
      if (variantName === initialVariant || !variant) {
        return { variantName, loadedVariant: null, fileNames: [] };
      }

      try {
        const { code: loadedVariant } = await loadVariant(
          url,
          variantName,
          variant,
          shouldHighlight ? parseSource : undefined,
          loadSource,
          loadVariantMeta,
          undefined, // sourceTransformers
          {
            disableTransforms: true,
            disableParsing: !shouldHighlight,
          },
        );

        // Collect file names from this variant
        const fileNames = [loadedVariant.fileName];
        if (loadedVariant.extraFiles) {
          fileNames.push(...Object.keys(loadedVariant.extraFiles));
        }

        return { variantName, loadedVariant, fileNames };
      } catch (error) {
        // Log but don't fail - we want to get as many file names as possible
        console.warn(`Failed to load variant ${variantName} for file listing: ${error}`);
        return { variantName, loadedVariant: null, fileNames: [] };
      }
    });

    const variantResults = await Promise.all(variantPromises);

    // Update loaded code and collect file names
    variantResults.forEach(({ variantName, loadedVariant, fileNames }) => {
      if (loadedVariant) {
        loaded = { ...loaded, [variantName]: loadedVariant };
      }
      fileNames.forEach((fileName) => allFileNames.add(fileName));
    });
  }

  // Ensure we have the latest initial variant data
  const finalInitial = loaded[initialVariant];
  if (!finalInitial || typeof finalInitial === 'string') {
    throw new Error(`Failed to process initial variant: ${initialVariant}`);
  }

  // Get the source for the requested filename (or main file if not specified) for the final return
  let finalFileSource: VariantSource;
  let finalFilename: string;

  try {
    const result = await getFileSource(finalInitial, initialFilename, loadSource);
    finalFileSource = result.source;
    finalFilename = result.filename;
  } catch (error) {
    // If we can't get the specific file, fall back to the main file
    finalFileSource = finalInitial.source || '';
    finalFilename = finalInitial.fileName;
  }

  return {
    code: loaded,
    initialFilename: finalFilename,
    initialSource: finalFileSource,
    initialExtraFiles: finalInitial.extraFiles || {},
    allFileNames: Array.from(allFileNames),
  };
}

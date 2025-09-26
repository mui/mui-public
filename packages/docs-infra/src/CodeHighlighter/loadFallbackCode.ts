import type {
  Code,
  VariantExtraFiles,
  VariantSource,
  VariantCode,
  LoadFallbackCodeOptions,
  LoadSource,
} from './types';
import { loadVariant } from './loadVariant';
import { getFileNameFromUrl } from '../pipeline/loaderUtils';
import { nameMark } from '../pipeline/loadPrecomputedCodeHighlighter/performanceLogger';

// Helper function to get the source for a specific filename from a variant
async function getFileSource(
  variant: VariantCode,
  requestedFilename: string | undefined,
  loadSource: LoadSource | undefined,
): Promise<{ source: VariantSource; filename: string | undefined }> {
  const filename = requestedFilename || variant.fileName;

  if (!filename) {
    // If no filename is available, return the main variant source
    if (variant.source !== undefined) {
      return { source: variant.source, filename: undefined };
    }
    throw new Error('No filename available and no source in variant');
  }

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
  initialFilename: string | undefined;
  initialSource: VariantSource;
  initialExtraFiles?: VariantExtraFiles;
  allFileNames: string[];
  processedGlobalsCode?: Array<Code>;
};

export async function loadFallbackCode(
  url: string,
  initialVariant: string,
  loaded: Code | undefined,
  options: LoadFallbackCodeOptions = {},
): Promise<FallbackVariants> {
  const {
    shouldHighlight,
    fallbackUsesExtraFiles,
    fallbackUsesAllVariants,
    sourceParser,
    loadSource,
    loadVariantMeta,
    loadCodeMeta,
    initialFilename,
    variants,
    globalsCode,
    output,
  } = options;
  loaded = { ...loaded };

  const functionName = 'Load Fallback Code';
  const startMark = nameMark(functionName, 'Start Loading', [url]);
  performance.mark(startMark);
  let currentMark = startMark;

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

    const loadedCodeMetaMark = nameMark(functionName, 'Loaded Code Meta', [url]);
    performance.mark(loadedCodeMetaMark);
    performance.measure(
      nameMark(functionName, 'Code Meta Loading', [url]),
      currentMark,
      loadedCodeMetaMark,
    );
    currentMark = loadedCodeMetaMark;
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
    if (initial.fileName) {
      allFileNames.add(initial.fileName);
    }
    if (initial.extraFiles) {
      Object.keys(initial.extraFiles).forEach((fileName) => allFileNames.add(fileName));
    }

    // Get the source for the requested filename (or main file if not specified)
    let fileSource: VariantSource;
    let actualFilename: string | undefined;

    try {
      const result = await getFileSource(initial, initialFilename, loadSource);
      fileSource = result.source;
      actualFilename = result.filename;
    } catch (error) {
      throw new Error(
        `Failed to get source for file ${initialFilename || initial.fileName} in variant ${initialVariant}: ${error}`,
      );
    }

    const loadedMainFileMark = nameMark(functionName, 'Loaded Main File', [url]);
    performance.mark(loadedMainFileMark);
    performance.measure(
      nameMark(functionName, 'Main File Loading', [url]),
      currentMark,
      loadedMainFileMark,
    );
    currentMark = loadedMainFileMark;

    // If we need highlighting and have a string source, parse it
    if (shouldHighlight && typeof fileSource === 'string' && sourceParser && actualFilename) {
      try {
        const parseSource = await sourceParser;
        fileSource = parseSource(fileSource, actualFilename);
      } catch (error) {
        throw new Error(
          `Failed to parse source for highlighting (variant: ${initialVariant}, file: ${actualFilename}): ${JSON.stringify(error)}`,
        );
      }

      const parsedMainFileMark = nameMark(functionName, 'Parsed Main File', [url]);
      performance.mark(parsedMainFileMark);
      performance.measure(
        nameMark(functionName, 'Main File Parsing', [url]),
        currentMark,
        parsedMainFileMark,
      );
      currentMark = parsedMainFileMark;
    } else if (shouldHighlight && typeof fileSource === 'string' && !actualFilename) {
      // Create basic HAST node when we can't parse due to missing filename
      // This marks that the source has passed through the parsing pipeline
      fileSource = {
        type: 'root',
        children: [
          {
            type: 'text',
            value: fileSource,
          },
        ],
      };
    }

    // Update the loaded code with any changes we made
    if (actualFilename && actualFilename === initial.fileName) {
      initial = { ...initial, source: fileSource };
      loaded = { ...loaded, [initialVariant]: initial };
    } else if (!actualFilename && !initial.fileName) {
      // If both are undefined, we're dealing with the main source
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

        const loadedInitialVariantMetaMark = nameMark(functionName, 'Loaded Initial Variant Meta', [
          url,
        ]);
        performance.mark(loadedInitialVariantMetaMark);
        performance.measure(
          nameMark(functionName, 'Initial Variant Meta Loading', [url]),
          currentMark,
          loadedInitialVariantMetaMark,
        );
        currentMark = loadedInitialVariantMetaMark;
      } else {
        // Create a basic variant using fallback logic
        quickVariant = {
          url: initial,
          fileName: getFileNameFromUrl(initial).fileName,
        };
      }

      const beforeInitialVariantMark = currentMark;

      loaded = { ...loaded, [initialVariant]: quickVariant };
      initial = quickVariant;

      // If we have all files listed and don't need extra file processing, we can optimize
      if (quickVariant.allFilesListed && !fallbackUsesExtraFiles && !fallbackUsesAllVariants) {
        // Collect all file names from the quick load
        const allFileNames = new Set<string>();
        if (quickVariant.fileName) {
          allFileNames.add(quickVariant.fileName);
        }
        if (quickVariant.extraFiles) {
          Object.keys(quickVariant.extraFiles).forEach((fileName) => allFileNames.add(fileName));
        }

        // Get the source for the requested filename (or main file if not specified)
        let fileSource: VariantSource;
        let actualFilename: string | undefined;

        try {
          const result = await getFileSource(quickVariant, initialFilename, loadSource);
          fileSource = result.source;
          actualFilename = result.filename;

          const loadedInitialFileMark = nameMark(functionName, 'Loaded Initial File', [
            initialFilename || 'unknown',
            url,
          ]);
          performance.mark(loadedInitialFileMark);
          performance.measure(
            nameMark(functionName, 'Initial File Loading', [initialFilename || 'unknown', url]),
            currentMark,
            loadedInitialFileMark,
          );
          currentMark = loadedInitialFileMark;
        } catch (error) {
          throw new Error(
            `Failed to get source for file ${initialFilename || quickVariant.fileName} in variant ${initialVariant}: ${error}`,
          );
        }

        // If we need highlighting and have a string source, parse it
        if (shouldHighlight && typeof fileSource === 'string' && sourceParser && actualFilename) {
          try {
            const parseSource = await sourceParser;
            fileSource = parseSource(fileSource, actualFilename);

            const parsedInitialFileMark = nameMark(functionName, 'Parsed Initial File', [
              initialFilename || 'unknown',
              url,
            ]);
            performance.mark(parsedInitialFileMark);
            performance.measure(
              nameMark(functionName, 'Initial File Parsing', [initialFilename || 'unknown', url]),
              currentMark,
              parsedInitialFileMark,
            );
            currentMark = parsedInitialFileMark;
          } catch (error) {
            throw new Error(
              `Failed to parse source for highlighting (variant: ${initialVariant}, file: ${actualFilename}): ${JSON.stringify(error)}`,
            );
          }
        } else if (shouldHighlight && typeof fileSource === 'string' && !actualFilename) {
          // Create basic HAST node when we can't parse due to missing filename
          // This marks that the source has passed through the parsing pipeline
          fileSource = {
            type: 'root',
            children: [
              {
                type: 'text',
                value: fileSource,
              },
            ],
          };
        }

        // Update the loaded code with any changes we made
        if (actualFilename && actualFilename === quickVariant.fileName) {
          initial = { ...quickVariant, source: fileSource };
          loaded = { ...loaded, [initialVariant]: initial };
        } else if (!actualFilename && !quickVariant.fileName) {
          // If both are undefined, we're dealing with the main source
          initial = { ...quickVariant, source: fileSource };
          loaded = { ...loaded, [initialVariant]: initial };
        }

        const loadedInitialFilesMark = nameMark(functionName, 'Loaded Initial Files', [url], true);
        performance.mark(loadedInitialFilesMark);
        performance.measure(
          nameMark(functionName, 'Initial Files Loading', [url], true),
          beforeInitialVariantMark,
          loadedInitialFilesMark,
        );
        currentMark = loadedInitialFilesMark;

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

  const beforeGlobalsMark = currentMark;

  // Step 2b: Fall back to full loadVariant processing
  // Load globalsCode - convert string URLs to Code objects, keep Code objects as-is
  let globalsCodeObjects: Array<Code> | undefined;
  if (globalsCode && globalsCode.length > 0) {
    const hasStringUrls = globalsCode.some((item) => typeof item === 'string');
    if (hasStringUrls && !loadCodeMeta) {
      throw new Error('loadCodeMeta function is required when globalsCode contains string URLs');
    }

    // Load all string URLs in parallel, keep Code objects as-is
    const globalsPromises = globalsCode.map(async (globalItem) => {
      if (typeof globalItem === 'string') {
        // String URL - load Code object via loadCodeMeta
        try {
          const codeMeta = await loadCodeMeta!(globalItem);

          const loadedGlobalCodeMark = nameMark(functionName, 'Loaded Global Code Meta', [
            globalItem,
            url,
          ]);
          performance.mark(loadedGlobalCodeMark);
          performance.measure(
            nameMark(functionName, 'Global Code Meta Loading', [globalItem, url]),
            currentMark,
            loadedGlobalCodeMark,
          );
          currentMark = loadedGlobalCodeMark;

          return codeMeta;
        } catch (error) {
          throw new Error(
            `Failed to load globalsCode from URL: ${globalItem}. Error: ${JSON.stringify(error)}`,
          );
        }
      } else {
        // Code object - return as-is
        return globalItem;
      }
    });

    globalsCodeObjects = await Promise.all(globalsPromises);

    const loadedGlobalCodeMark = nameMark(functionName, 'Loaded Globals Meta', [url], true);
    performance.mark(loadedGlobalCodeMark);
    performance.measure(
      nameMark(functionName, 'Globals Meta Loading', [url], true),
      beforeGlobalsMark,
      loadedGlobalCodeMark,
    );
    currentMark = loadedGlobalCodeMark;
  }

  // Convert globalsCodeObjects to VariantCode | string for this specific variant
  let resolvedGlobalsCode: Array<VariantCode | string> | undefined;
  if (globalsCodeObjects && globalsCodeObjects.length > 0) {
    resolvedGlobalsCode = [];
    for (const codeObj of globalsCodeObjects) {
      // Only use the variant that matches the current initialVariant
      const targetVariant = codeObj[initialVariant];
      if (targetVariant) {
        resolvedGlobalsCode.push(targetVariant);
      }
    }
  }

  try {
    const { code: loadedVariant } = await loadVariant(url, initialVariant, initial, {
      sourceParser,
      loadSource,
      loadVariantMeta,
      sourceTransformers: undefined, // sourceTransformers - skip transforms for fallback
      disableTransforms: true, // Don't apply transforms for fallback
      disableParsing: !shouldHighlight, // Only parse if highlighting is needed
      globalsCode: resolvedGlobalsCode, // Pass resolved globalsCode
      output,
    });

    const loadedInitialVariantMark = nameMark(functionName, 'Loaded Initial Variant', [url], true);
    performance.mark(loadedInitialVariantMark);
    performance.measure(
      nameMark(functionName, 'Initial Variant Loading', [url], true),
      currentMark,
      loadedInitialVariantMark,
    );
    currentMark = loadedInitialVariantMark;

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
  if (initial.fileName) {
    allFileNames.add(initial.fileName);
  }

  // Add extra files from the initial variant
  if (initial.extraFiles) {
    Object.keys(initial.extraFiles).forEach((fileName) => allFileNames.add(fileName));
  }

  // Step 4: Handle fallbackUsesAllVariants - load all variants to get all possible files
  if (fallbackUsesAllVariants) {
    const beforeAllVariantMark = currentMark;

    // Determine all variants to process - use provided variants or infer from loaded code
    const allVariants = variants || Object.keys(loaded || {});

    if (allVariants.length === 0) {
      console.warn('No variants found for fallbackUsesAllVariants processing');
    } else {
      // Process all required variants, not just the ones already loaded
      const variantPromises = allVariants.map(async (variantName) => {
        if (variantName === initialVariant) {
          // Skip initial variant as it's already processed
          return { variantName, loadedVariant: null, fileNames: [] };
        }

        let variant = loaded?.[variantName];

        // If variant is not loaded yet, load it first using loadCodeMeta
        if (!variant && loadCodeMeta) {
          try {
            const allCode = await loadCodeMeta(url);
            variant = allCode[variantName];
            // Update loaded with all variants from loadCodeMeta
            loaded = { ...loaded, ...allCode };

            const loadedInitialCodeMetaMark = nameMark(functionName, 'Loaded Initial Code Meta', [
              url,
            ]);
            performance.mark(loadedInitialCodeMetaMark);
            performance.measure(
              nameMark(functionName, 'Initial Code Meta Loading', [url]),
              currentMark,
              loadedInitialCodeMetaMark,
            );
            currentMark = loadedInitialCodeMetaMark;
          } catch (error) {
            console.warn(`Failed to load code meta for variant ${variantName}: ${error}`);
            return { variantName, loadedVariant: null, fileNames: [] };
          }
        }

        if (!variant) {
          console.warn(`Variant ${variantName} not found after loading code meta`);
          return { variantName, loadedVariant: null, fileNames: [] };
        }

        try {
          const { code: loadedVariant } = await loadVariant(url, variantName, variant, {
            sourceParser,
            loadSource,
            loadVariantMeta,
            sourceTransformers: undefined, // sourceTransformers
            disableTransforms: true,
            disableParsing: !shouldHighlight,
            output,
            globalsCode:
              globalsCodeObjects && globalsCodeObjects.length > 0
                ? (() => {
                    // Convert globalsCodeObjects to VariantCode | string for this specific variant
                    const variantGlobalsCode: Array<VariantCode | string> = [];
                    for (const codeObj of globalsCodeObjects) {
                      // Only use the variant that matches the current variantName
                      const targetVariant = codeObj[variantName];
                      if (targetVariant) {
                        variantGlobalsCode.push(targetVariant);
                      }
                    }
                    return variantGlobalsCode;
                  })()
                : undefined,
          });

          // Collect file names from this variant
          const fileNames = loadedVariant.fileName ? [loadedVariant.fileName] : [];
          if (loadedVariant.extraFiles) {
            fileNames.push(...Object.keys(loadedVariant.extraFiles));
          }

          const loadedInitialVariantMark = nameMark(
            functionName,
            'Loaded Initial Variant',
            [variantName, url],
            true,
          );
          performance.mark(loadedInitialVariantMark);
          performance.measure(
            nameMark(functionName, 'Initial Variant Loading', [variantName, url], true),
            currentMark,
            loadedInitialVariantMark,
          );
          currentMark = loadedInitialVariantMark;

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

    const loadedInitialVariantsMark = nameMark(
      functionName,
      'Loaded Initial Variants',
      [url],
      true,
    );
    performance.mark(loadedInitialVariantsMark);
    performance.measure(
      nameMark(functionName, 'Initial Variants Loading', [url], true),
      beforeAllVariantMark,
      loadedInitialVariantsMark,
    );
    currentMark = loadedInitialVariantsMark;
  }

  // Ensure we have the latest initial variant data
  const finalInitial = loaded[initialVariant];
  if (!finalInitial || typeof finalInitial === 'string') {
    throw new Error(`Failed to process initial variant: ${initialVariant}`);
  }

  // Get the source for the requested filename (or main file if not specified) for the final return
  let finalFileSource: VariantSource;
  let finalFilename: string | undefined;

  try {
    const result = await getFileSource(finalInitial, initialFilename, loadSource);
    finalFileSource = result.source;
    finalFilename = result.filename;
  } catch (error) {
    // If we can't get the specific file, fall back to main file
    if (!finalInitial.fileName && !finalInitial.source) {
      throw new Error(
        `Cannot determine filename for initial variant "${initialVariant}". ` +
          `No fileName available in variant definition, no initialFilename provided, and no source available.`,
      );
    }

    // Fall back to the main file with proper validation
    finalFileSource = finalInitial.source || '';
    finalFilename = finalInitial.fileName;
  }

  const loadedInitialFileMark = nameMark(functionName, 'Loaded Initial File', [url]);
  performance.mark(loadedInitialFileMark);
  performance.measure(
    nameMark(functionName, 'Initial File Loading', [url]),
    currentMark,
    loadedInitialFileMark,
  );

  return {
    code: loaded,
    initialFilename: finalFilename,
    initialSource: finalFileSource,
    initialExtraFiles: finalInitial.extraFiles || {},
    allFileNames: Array.from(allFileNames),
    processedGlobalsCode: globalsCodeObjects,
  };
}

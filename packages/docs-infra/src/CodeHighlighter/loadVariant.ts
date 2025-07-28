import { transformSource } from './transformSource';
import { transformParsedSource } from './transformParsedSource';
import { getFileNameFromUrl } from '../loaderUtils';
import type {
  VariantCode,
  VariantSource,
  VariantExtraFiles,
  Transforms,
  ParseSource,
  LoadSource,
  LoadVariantMeta,
  SourceTransformers,
  LoadFileOptions,
} from './types';

// Helper function to check if we're in production
function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

// Helper function to convert a nested key based on the directory of the source file key
function convertKeyBasedOnDirectory(nestedKey: string, sourceFileKey: string): string {
  // If it's an absolute path (starts with / or contains ://), keep as-is
  if (nestedKey.startsWith('/') || nestedKey.includes('://')) {
    return nestedKey;
  }

  // Treat bare filenames as relative to current directory (same as ./filename)
  let processedNestedKey = nestedKey;
  if (!nestedKey.startsWith('.')) {
    processedNestedKey = `./${nestedKey}`;
  }

  // Manual path resolution: resolve processedNestedKey relative to the directory of sourceFileKey
  // Both paths are relative to the entry directory (which is always './') - ignore file:// URLs completely

  // Get the directory of the source file key (not URL)
  const sourceDir = sourceFileKey.includes('/')
    ? sourceFileKey.substring(0, sourceFileKey.lastIndexOf('/'))
    : '.';

  // Parse both paths into components
  const parsePathComponents = (path: string): string[] => {
    if (path === '.' || path === '') {
      return [];
    }
    return path.split('/').filter((part) => part !== '');
  };

  const sourceDirComponents = parsePathComponents(sourceDir);
  const nestedComponents = parsePathComponents(processedNestedKey);

  // Start from the source directory and apply the nested path
  const resultComponents: string[] = [...sourceDirComponents];

  // Apply each component of the nested path
  for (const component of nestedComponents) {
    if (component === '..') {
      if (resultComponents.length > 0 && resultComponents[resultComponents.length - 1] !== '..') {
        // Normal case: pop a regular directory component
        resultComponents.pop();
      } else {
        // Either resultComponents is empty OR the last component is already '..'
        // In both cases, we need to go up one more level
        resultComponents.push('..');
      }
    } else if (component === '.') {
      // Current directory, skip
      continue;
    } else {
      resultComponents.push(component);
    }
  }

  // Build the final result
  if (resultComponents.length === 0) {
    return '';
  }

  const result = resultComponents.join('/');
  return result;
}

/**
 * Normalize a relative path key by removing unnecessary ./ prefix
 */
function normalizePathKey(key: string): string {
  if (key.startsWith('./')) {
    return key.substring(2);
  }
  return key;
}

/**
 * Loads and processes extra files recursively with support for relative paths
 * and circular dependency detection. Uses Promise.all for parallel loading.
 */

async function loadSingleFile(
  variantName: string,
  fileName: string,
  source: VariantSource | undefined,
  url: string | undefined,
  loadSource: LoadSource | undefined,
  sourceParser: Promise<ParseSource> | undefined,
  sourceTransformers: SourceTransformers | undefined,
  loadSourceCache: Map<
    string,
    Promise<{ source: VariantSource; extraFiles?: VariantExtraFiles; extraDependencies?: string[] }>
  >,
  transforms?: Transforms,
  options: LoadFileOptions = {},
  allFilesListed: boolean = false,
  knownExtraFiles: Set<string> = new Set(),
): Promise<{
  source: VariantSource;
  transforms?: Transforms;
  extraFiles?: VariantExtraFiles;
  extraDependencies?: string[];
}> {
  const { disableTransforms = false, disableParsing = false } = options;

  let finalSource = source;
  let extraFilesFromSource: VariantExtraFiles | undefined;
  let extraDependenciesFromSource: string[] | undefined;

  // Load source if not provided
  if (!finalSource) {
    if (!loadSource) {
      throw new Error('"loadSource" function is required when source is not provided');
    }

    if (!url) {
      throw new Error('URL is required when loading source');
    }

    try {
      // Check cache first to avoid duplicate loadSource calls
      let loadPromise = loadSourceCache.get(url);
      if (!loadPromise) {
        loadPromise = loadSource(url);
        loadSourceCache.set(url, loadPromise);
      }

      const loadResult = await loadPromise;
      finalSource = loadResult.source;
      extraFilesFromSource = loadResult.extraFiles;
      extraDependenciesFromSource = loadResult.extraDependencies;

      // Validate that extraFiles from loadSource contain only absolute URLs as values
      if (extraFilesFromSource) {
        for (const [extraFileName, fileData] of Object.entries(extraFilesFromSource)) {
          // Validate that keys are relative paths (not absolute)
          if (extraFileName.includes('://') || extraFileName.startsWith('/')) {
            throw new Error(
              `Invalid extraFiles from loadSource: key "${extraFileName}" appears to be an absolute path. ` +
                `extraFiles keys should be relative paths from the current file.`,
            );
          }

          // Validate that values are absolute URLs (not relative paths)
          if (typeof fileData === 'string' && fileData.startsWith('.')) {
            throw new Error(
              `Invalid extraFiles from loadSource: "${extraFileName}" has relative path "${fileData}". ` +
                `All extraFiles values must be absolute URLs.`,
            );
          }
        }
      }

      // Validate that extraDependencies from loadSource contain only absolute URLs
      if (extraDependenciesFromSource) {
        for (const dependency of extraDependenciesFromSource) {
          if (dependency.startsWith('.')) {
            throw new Error(
              `Invalid extraDependencies from loadSource: "${dependency}" is a relative path. ` +
                `All extraDependencies must be absolute URLs.`,
            );
          }
          if (dependency === url) {
            throw new Error(
              `Invalid extraDependencies from loadSource: "${dependency}" is the same as the input URL. ` +
                `extraDependencies should not include the file being loaded.`,
            );
          }
        }
      }

      // Check for new files when allFilesListed is enabled
      if (allFilesListed && (extraFilesFromSource || extraDependenciesFromSource)) {
        const newFiles: string[] = [];

        if (extraFilesFromSource) {
          // Check if any extraFiles keys are not in the known set
          for (const extraFileKey of Object.keys(extraFilesFromSource)) {
            if (!knownExtraFiles.has(extraFileKey)) {
              newFiles.push(extraFileKey);
            }
          }
        }

        if (newFiles.length > 0) {
          const message =
            `Unexpected files discovered via loadSource when allFilesListed=true (variant: ${variantName}, file: ${fileName}). ` +
            `New files: ${newFiles.join(', ')}. ` +
            `Please update the loadVariantMeta function to provide the complete list of files upfront.`;

          if (isProduction()) {
            console.warn(message);
          } else {
            throw new Error(message); // TODO: maybe this could use a visual warning instead
          }
        }
      }
    } catch (error) {
      // Re-throw validation errors without wrapping them
      if (
        error instanceof Error &&
        (error.message.startsWith('Invalid extraFiles from loadSource:') ||
          error.message.startsWith('Invalid extraDependencies from loadSource:') ||
          error.message.startsWith(
            'Unexpected files discovered via loadSource when allFilesListed=true',
          ))
      ) {
        throw error;
      }
      throw new Error(
        `Failed to load source code (variant: ${variantName}, file: ${fileName}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  // Apply source transformers if no transforms exist and transforms are not disabled
  let finalTransforms = transforms;
  if (sourceTransformers && !finalTransforms && !disableTransforms && finalSource) {
    finalTransforms = await transformSource(
      finalSource,
      normalizePathKey(fileName),
      sourceTransformers,
    );
  }

  // Parse source if it's a string and parsing is not disabled
  if (typeof finalSource === 'string' && !disableParsing) {
    if (!sourceParser) {
      throw new Error(
        '"sourceParser" function is required when source is a string and parsing is not disabled',
      );
    }

    try {
      const sourceString = finalSource;
      const parseSource = await sourceParser;
      finalSource = parseSource(finalSource, fileName);

      if (finalTransforms && !disableTransforms) {
        finalTransforms = await transformParsedSource(
          sourceString,
          finalSource,
          normalizePathKey(fileName),
          finalTransforms,
          parseSource,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to parse source code (variant: ${variantName}, file: ${fileName}, url: ${url}): ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  return {
    source: finalSource!,
    transforms: finalTransforms,
    extraFiles: extraFilesFromSource,
    extraDependencies: extraDependenciesFromSource,
  };
}

/**
 * Loads and processes extra files recursively with support for relative paths
 * and circular dependency detection. Uses Promise.all for parallel loading.
 */
async function loadExtraFiles(
  variantName: string,
  extraFiles: VariantExtraFiles,
  baseUrl: string,
  entryUrl: string, // Track the original entry file URL
  loadSource: LoadSource | undefined,
  sourceParser: Promise<ParseSource> | undefined,
  sourceTransformers: SourceTransformers | undefined,
  loadSourceCache: Map<
    string,
    Promise<{ source: VariantSource; extraFiles?: VariantExtraFiles; extraDependencies?: string[] }>
  >,
  options: LoadFileOptions = {},
  allFilesListed: boolean = false,
  knownExtraFiles: Set<string> = new Set(),
): Promise<{ extraFiles: VariantExtraFiles; allFilesUsed: string[] }> {
  const { maxDepth = 10, loadedFiles = new Set() } = options;

  if (maxDepth <= 0) {
    throw new Error('Maximum recursion depth reached while loading extra files');
  }

  const processedExtraFiles: VariantExtraFiles = {};
  const allFilesUsed: string[] = [];

  // Start loading all extra files in parallel
  const extraFilePromises = Object.entries(extraFiles).map(async ([fileName, fileData]) => {
    try {
      let fileUrl: string;
      let sourceData: VariantSource | undefined;
      let transforms: Transforms | undefined;

      if (typeof fileData === 'string') {
        // fileData is a URL/path - use it directly, don't modify it
        fileUrl = fileData;

        // Check for circular dependencies
        if (loadedFiles.has(fileUrl)) {
          throw new Error(`Circular dependency detected: ${fileUrl}`);
        }

        loadedFiles.add(fileUrl);
      } else {
        // fileData is an object with source and/or transforms
        sourceData = fileData.source;
        transforms = fileData.transforms;
        fileUrl = baseUrl; // Use base URL as fallback
      }

      // Load the file (this will handle recursive extra files)
      const fileResult = await loadSingleFile(
        variantName,
        fileName,
        sourceData,
        fileUrl,
        loadSource,
        sourceParser,
        sourceTransformers,
        loadSourceCache,
        transforms,
        { ...options, maxDepth: maxDepth - 1, loadedFiles: new Set(loadedFiles) },
        allFilesListed,
        knownExtraFiles,
      );

      // Collect files used from this file load
      const filesUsedFromFile: string[] = [];
      if (typeof fileData === 'string') {
        filesUsedFromFile.push(fileUrl);
      }
      if (fileResult.extraDependencies) {
        filesUsedFromFile.push(...fileResult.extraDependencies);
      }

      return {
        fileName,
        result: fileResult,
        filesUsed: filesUsedFromFile,
      };
    } catch (error) {
      throw new Error(
        `Failed to load extra file (variant: ${variantName}, file: ${fileName}, url: ${baseUrl}): ${error instanceof Error ? error.message : ''}`,
      );
    }
  });

  // Wait for all extra files to load
  const extraFileResults = await Promise.all(extraFilePromises);

  // Process results and handle nested extra files
  const nestedExtraFilesPromises: Promise<{
    files: VariantExtraFiles;
    allFilesUsed: string[];
    sourceFileKey: string; // Track the key (relative path) that led to these nested files
  }>[] = [];

  for (const { fileName, result, filesUsed } of extraFileResults) {
    const normalizedFileName = normalizePathKey(fileName);
    processedExtraFiles[normalizedFileName] = {
      source: result.source,
      transforms: result.transforms,
    };

    // Add files used from this file load
    allFilesUsed.push(...filesUsed);

    // Collect promises for nested extra files with their source key
    if (result.extraFiles) {
      let sourceFileUrl = baseUrl;
      const fileData = extraFiles[fileName];
      if (typeof fileData === 'string') {
        sourceFileUrl = fileData; // Use the URL directly, don't modify it
      }

      nestedExtraFilesPromises.push(
        loadExtraFiles(
          variantName,
          result.extraFiles,
          sourceFileUrl, // Use the source file's URL as base for its extra files
          entryUrl, // Keep the entry URL for final conversion
          loadSource,
          sourceParser,
          sourceTransformers,
          loadSourceCache,
          { ...options, maxDepth: maxDepth - 1, loadedFiles: new Set(loadedFiles) },
          allFilesListed,
          knownExtraFiles,
        ).then((nestedResult) => ({
          files: nestedResult.extraFiles,
          allFilesUsed: nestedResult.allFilesUsed,
          sourceFileKey: normalizedFileName, // Pass the normalized key
        })),
      );
    }
  }

  // Wait for all nested extra files and merge them, converting paths based on key structure
  if (nestedExtraFilesPromises.length > 0) {
    const nestedExtraFilesResults = await Promise.all(nestedExtraFilesPromises);
    for (const {
      files: nestedExtraFiles,
      allFilesUsed: nestedFilesUsed,
      sourceFileKey,
    } of nestedExtraFilesResults) {
      // Add nested files used
      allFilesUsed.push(...nestedFilesUsed);

      for (const [nestedKey, nestedValue] of Object.entries(nestedExtraFiles)) {
        // Convert the key based on the directory structure of the source key
        const convertedKey = convertKeyBasedOnDirectory(nestedKey, sourceFileKey);
        const normalizedConvertedKey = normalizePathKey(convertedKey);
        processedExtraFiles[normalizedConvertedKey] = nestedValue;
      }
    }
  }

  return { extraFiles: processedExtraFiles, allFilesUsed };
}

/**
 * Loads a variant with support for recursive extra file loading.
 * The loadSource function can now return extraFiles that will be loaded recursively.
 * Supports both relative and absolute paths for extra files.
 * Uses Promise.all for efficient parallel loading of extra files.
 */
export async function loadVariant(
  url: string | undefined,
  variantName: string,
  variant: VariantCode | string | undefined,
  sourceParser?: Promise<ParseSource>,
  loadSource?: LoadSource,
  loadVariantMeta?: LoadVariantMeta,
  sourceTransformers?: SourceTransformers,
  options: LoadFileOptions = {},
): Promise<{ code: VariantCode; dependencies: string[] }> {
  if (!variant) {
    throw new Error(`Variant is missing from code: ${variantName}`);
  }

  // Create a cache for loadSource calls scoped to this loadVariant call
  const loadSourceCache = new Map<
    string,
    Promise<{ source: VariantSource; extraFiles?: VariantExtraFiles; extraDependencies?: string[] }>
  >();

  if (typeof variant === 'string') {
    if (!loadVariantMeta) {
      // Create a basic loadVariantMeta function as fallback
      const { fileName } = getFileNameFromUrl(variant);
      if (!fileName) {
        throw new Error(
          `Cannot determine fileName from URL "${variant}" for variant "${variantName}". ` +
            `Please provide a loadVariantMeta function or ensure the URL has a valid file extension.`,
        );
      }
      variant = {
        url: variant,
        fileName,
      };
    } else {
      try {
        variant = await loadVariantMeta(variantName, variant);
      } catch (error) {
        throw new Error(
          `Failed to load variant code (variant: ${variantName}, url: ${variant}): ${JSON.stringify(error)}`,
        );
      }
    }
  }

  const loadedFiles = new Set<string>();
  if (url) {
    loadedFiles.add(url);
  }
  const allFilesUsed: string[] = url ? [url] : []; // Start with the main file URL if available

  // Build set of known extra files from variant definition
  const knownExtraFiles = new Set<string>();
  if (variant.extraFiles) {
    for (const extraFileName of Object.keys(variant.extraFiles)) {
      knownExtraFiles.add(extraFileName);
    }
  }

  // Load main file
  const fileName = variant.fileName || (url ? getFileNameFromUrl(url).fileName : undefined);

  // If we don't have a fileName and no URL, we can't parse or transform but can still return the code
  if (!fileName && !url) {
    // Return the variant as-is without parsing or transforms
    const finalVariant: VariantCode = {
      ...variant,
      source:
        typeof variant.source === 'string'
          ? {
              type: 'root',
              children: [
                {
                  type: 'text',
                  value: variant.source || '',
                },
              ],
            }
          : variant.source,
    };

    return {
      code: finalVariant,
      dependencies: [], // No dependencies without URL
    };
  }

  if (!fileName) {
    throw new Error(
      `No fileName available for variant "${variantName}". ` +
        `Please provide a fileName in the variant definition or ensure the URL has a valid file extension.`,
    );
  }

  const mainFileResult = await loadSingleFile(
    variantName,
    fileName,
    variant.source,
    url,
    loadSource,
    sourceParser,
    sourceTransformers,
    loadSourceCache,
    variant.transforms,
    { ...options, loadedFiles },
    variant.allFilesListed || false,
    knownExtraFiles,
  );

  // Add files used from main file loading
  if (mainFileResult.extraDependencies) {
    allFilesUsed.push(...mainFileResult.extraDependencies);
  }

  let allExtraFiles: VariantExtraFiles = {};

  // Validate extraFiles keys from variant definition
  if (variant.extraFiles) {
    for (const extraFileName of Object.keys(variant.extraFiles)) {
      // Check if key is an absolute URL (should be relative)
      if (extraFileName.includes('://') || extraFileName.startsWith('/')) {
        throw new Error(
          `Invalid extraFiles key in variant: "${extraFileName}" appears to be an absolute path. ` +
            `extraFiles keys in variant definition should be relative paths from the main file.`,
        );
      }
    }
  }

  // Collect extra files from variant definition and from loaded source
  const extraFilesToLoad: VariantExtraFiles = {
    ...(variant.extraFiles || {}),
    ...(mainFileResult.extraFiles || {}),
  };

  // Load all extra files if any exist and we have a URL
  if (Object.keys(extraFilesToLoad).length > 0) {
    if (!url) {
      // If there's no URL, we can only load extra files that have inline source or absolute URLs
      const loadableFiles: VariantExtraFiles = {};
      for (const [key, value] of Object.entries(extraFilesToLoad)) {
        if (typeof value !== 'string' && value.source !== undefined) {
          // Inline source - can always load
          loadableFiles[key] = value;
        } else if (typeof value === 'string' && (value.includes('://') || value.startsWith('/'))) {
          // Absolute URL - can load without base URL
          loadableFiles[key] = value;
        } else {
          console.warn(
            `Skipping extra file "${key}" - no URL provided and file requires loading from external source`,
          );
        }
      }

      if (Object.keys(loadableFiles).length > 0) {
        // Process loadable files: inline sources without URL-based loading, absolute URLs with loading
        for (const [key, value] of Object.entries(loadableFiles)) {
          if (typeof value !== 'string') {
            // Inline source
            allExtraFiles[normalizePathKey(key)] = {
              source: value.source!,
              transforms: value.transforms,
            };
          }
        }

        // For absolute URLs, we need to load them
        const urlFilesToLoad: VariantExtraFiles = {};
        for (const [key, value] of Object.entries(loadableFiles)) {
          if (typeof value === 'string') {
            urlFilesToLoad[key] = value;
          }
        }

        if (Object.keys(urlFilesToLoad).length > 0) {
          // Load absolute URL files even without base URL
          const extraFilesResult = await loadExtraFiles(
            variantName,
            urlFilesToLoad,
            '', // No base URL needed for absolute URLs
            '', // No entry URL
            loadSource,
            sourceParser,
            sourceTransformers,
            loadSourceCache,
            { ...options, loadedFiles },
            variant.allFilesListed || false,
            knownExtraFiles,
          );
          allExtraFiles = { ...allExtraFiles, ...extraFilesResult.extraFiles };
          allFilesUsed.push(...extraFilesResult.allFilesUsed);
        }
      }
    } else {
      const extraFilesResult = await loadExtraFiles(
        variantName,
        extraFilesToLoad,
        url,
        url, // Entry URL is the same as the main file URL
        loadSource,
        sourceParser,
        sourceTransformers,
        loadSourceCache,
        { ...options, loadedFiles },
        variant.allFilesListed || false,
        knownExtraFiles,
      );
      allExtraFiles = extraFilesResult.extraFiles;
      allFilesUsed.push(...extraFilesResult.allFilesUsed);
    }
  }

  const finalVariant: VariantCode = {
    ...variant,
    source: mainFileResult.source,
    transforms: mainFileResult.transforms,
    extraFiles: Object.keys(allExtraFiles).length > 0 ? allExtraFiles : undefined,
  };

  return {
    code: finalVariant,
    dependencies: Array.from(new Set(allFilesUsed)), // Remove duplicates
  };
}

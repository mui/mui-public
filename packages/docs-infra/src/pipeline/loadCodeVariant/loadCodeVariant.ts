import * as path from 'path-module';
import { compress, AsyncGzipOptions, strToU8 } from 'fflate';
import { encode } from 'uint8-to-base64';
import { transformSource } from './transformSource';
import { diffHast } from './diffHast';
import { getFileNameFromUrl } from '../loaderUtils';
import { mergeExternals } from '../loaderUtils/mergeExternals';
import type {
  VariantCode,
  VariantSource,
  VariantExtraFiles,
  Transforms,
  ParseSource,
  LoadSource,
  SourceTransformers,
  LoadFileOptions,
  LoadVariantOptions,
  Externals,
} from '../../CodeHighlighter/types';
import { performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';

function compressAsync(input: Uint8Array, options: AsyncGzipOptions = {}): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    compress(input, options, (err, output) => {
      if (err) {
        reject(err);
      } else {
        resolve(output);
      }
    });
  });
}

/**
 * Check if a path is absolute (either filesystem absolute or URL)
 */
function isAbsolutePath(filePath: string): boolean {
  return path.isAbsolute(filePath) || filePath.includes('://');
}

/**
 * Generate a conflict-free filename for globalsCode files.
 * Strategy:
 * 1. Try original filename
 * 2. If conflict, try "global_" prefix
 * 3. If still conflict, add numbers: "global_filename_1.ext", "global_filename_2.ext", etc.
 */
function generateConflictFreeFilename(
  originalFilename: string,
  existingFiles: Set<string>,
): string {
  // First try the original filename
  if (!existingFiles.has(originalFilename)) {
    return originalFilename;
  }

  // Try with global_ prefix
  const globalFilename = `global_${originalFilename}`;
  if (!existingFiles.has(globalFilename)) {
    return globalFilename;
  }

  // Use path.parse to cleanly split filename into name and extension
  const parsed = path.parse(originalFilename);
  const nameWithoutExt = parsed.name;
  const extension = parsed.ext;

  // Add numbers until we find a free name, preserving extension
  let counter = 1;
  let candidateName: string;
  do {
    candidateName = `global_${nameWithoutExt}_${counter}${extension}`;
    counter += 1;
  } while (existingFiles.has(candidateName));

  return candidateName;
}

// Helper function to check if we're in production
function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

// Helper function to convert a nested key based on the directory of the source file key
function convertKeyBasedOnDirectory(nestedKey: string, sourceFileKey: string): string {
  // If it's an absolute path (starts with / or contains ://), keep as-is
  if (isAbsolutePath(nestedKey)) {
    return nestedKey;
  }

  // Treat bare filenames as relative to current directory (same as ./filename)
  let processedNestedKey = nestedKey;
  if (!nestedKey.startsWith('.')) {
    processedNestedKey = `./${nestedKey}`;
  }

  // Use path module for clean path resolution
  const sourceDir = path.dirname(sourceFileKey);
  const resolvedPath = path.resolve(sourceDir, processedNestedKey);

  // Convert back to relative path from current directory
  const result = path.relative('.', resolvedPath);

  // Return empty string if result is '.' (current directory)
  return result === '.' ? '' : result;
}

/**
 * Normalize a relative path key by removing unnecessary ./ prefix and cleaning up the path
 */
function normalizePathKey(key: string): string {
  // Handle edge cases
  if (key === '.' || key === '') {
    return '';
  }

  // Use path.normalize to clean up the path, then remove leading './' if present
  const normalized = path.normalize(key);

  // Convert './filename' to 'filename' using path.relative
  if (normalized.startsWith('./')) {
    return path.relative('.', normalized);
  }
  return normalized === '.' ? '' : normalized;
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
    Promise<{
      source: VariantSource;
      extraFiles?: VariantExtraFiles;
      extraDependencies?: string[];
      externals?: Externals;
    }>
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
  externals?: Externals;
}> {
  const { disableTransforms = false, disableParsing = false } = options;

  let finalSource = source;
  let extraFilesFromSource: VariantExtraFiles | undefined;
  let extraDependenciesFromSource: string[] | undefined;
  let externalsFromSource: Externals | undefined;

  const functionName = 'Load Variant File';
  let currentMark = performanceMeasure(
    undefined,
    { mark: 'Start', measure: 'Start' },
    [functionName, url || fileName],
    true,
  );

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
      externalsFromSource = loadResult.externals;

      currentMark = performanceMeasure(
        currentMark,
        { mark: 'Loaded File', measure: 'File Loading' },
        [functionName, url],
      );

      // Validate that extraFiles from loadSource contain only absolute URLs as values
      if (extraFilesFromSource) {
        for (const [extraFileName, fileData] of Object.entries(extraFilesFromSource)) {
          // Validate that keys are relative paths (not absolute)
          if (isAbsolutePath(extraFileName)) {
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
            throw new Error(message);
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

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Transformed File', measure: 'File Transforming' },
      [functionName, url || fileName],
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

      currentMark = performanceMeasure(
        currentMark,
        { mark: 'Parsed File', measure: 'File Parsing' },
        [functionName, url || fileName],
      );

      if (finalTransforms && !disableTransforms) {
        finalTransforms = await diffHast(
          sourceString,
          finalSource,
          normalizePathKey(fileName),
          finalTransforms,
          parseSource,
        );

        currentMark = performanceMeasure(
          currentMark,
          { mark: 'Transform Parsed File', measure: 'Parsed File Transforming' },
          [functionName, url || fileName],
        );
      }

      if (options.output === 'hastGzip' && process.env.NODE_ENV === 'production') {
        const hastGzip = encode(
          await compressAsync(strToU8(JSON.stringify(finalSource)), { consume: true, level: 9 }),
        );
        finalSource = { hastGzip };

        currentMark = performanceMeasure(
          currentMark,
          { mark: 'Compressed File', measure: 'File Compression' },
          [functionName, url || fileName],
        );
      } else if (options.output === 'hastJson' || options.output === 'hastGzip') {
        // in development, we skip compression but still convert to JSON
        finalSource = { hastJson: JSON.stringify(finalSource) };

        performanceMeasure(
          currentMark,
          { mark: 'JSON Stringified File', measure: 'File Stringification' },
          [functionName, url || fileName],
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
    externals: externalsFromSource,
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
    Promise<{
      source: VariantSource;
      extraFiles?: VariantExtraFiles;
      extraDependencies?: string[];
      externals?: Externals;
    }>
  >,
  options: LoadFileOptions = {},
  allFilesListed: boolean = false,
  knownExtraFiles: Set<string> = new Set(),
  globalsFileKeys: Set<string> = new Set(), // Track which files came from globals
): Promise<{ extraFiles: VariantExtraFiles; allFilesUsed: string[]; allExternals: Externals }> {
  const { maxDepth = 10, loadedFiles = new Set() } = options;

  if (maxDepth <= 0) {
    throw new Error('Maximum recursion depth reached while loading extra files');
  }

  const processedExtraFiles: VariantExtraFiles = {};
  const allFilesUsed: string[] = [];
  const allExternals: Externals = {};

  // Start loading all extra files in parallel
  const extraFilePromises = Object.entries(extraFiles).map(async ([fileName, fileData]) => {
    try {
      let fileUrl: string;
      let sourceData: VariantSource | undefined;
      let transforms: Transforms | undefined;
      let nextLoadedFiles: Set<string>;

      if (typeof fileData === 'string') {
        // fileData is a URL/path - use it directly, don't modify it
        fileUrl = fileData;

        // Check for circular dependencies
        if (loadedFiles.has(fileUrl)) {
          throw new Error(`Circular dependency detected: ${fileUrl}`);
        }

        // Create a new set with the current file added for the recursive call
        // Don't mutate the parent's loadedFiles set
        nextLoadedFiles = new Set(loadedFiles);
        nextLoadedFiles.add(fileUrl);
      } else {
        // fileData is an object with source and/or transforms
        sourceData = fileData.source;
        transforms = fileData.transforms;
        fileUrl = baseUrl; // Use base URL as fallback
        // For inline source, just pass a copy of loadedFiles without adding current file
        nextLoadedFiles = new Set(loadedFiles);
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
        { ...options, maxDepth: maxDepth - 1, loadedFiles: nextLoadedFiles },
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

      // Collect externals from this file load
      const externalsFromFile: Externals = {};
      if (fileResult.externals) {
        Object.assign(externalsFromFile, fileResult.externals);
      }

      return {
        fileName,
        result: fileResult,
        filesUsed: filesUsedFromFile,
        externals: externalsFromFile,
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
    allExternals: Externals;
    sourceFileKey: string; // Track the key (relative path) that led to these nested files
  }>[] = [];

  for (const { fileName, result, filesUsed, externals } of extraFileResults) {
    const normalizedFileName = normalizePathKey(fileName);
    const originalFileData = extraFiles[fileName];

    // Preserve metadata flag if it exists in the original data, or if this file came from globals
    let metadata: boolean | undefined;
    if (typeof originalFileData !== 'string') {
      metadata = originalFileData.metadata;
    } else if (globalsFileKeys.has(fileName)) {
      metadata = true;
    }

    processedExtraFiles[normalizedFileName] = {
      source: result.source,
      transforms: result.transforms,
      ...(metadata !== undefined && { metadata }),
    };

    // Add files used from this file load
    allFilesUsed.push(...filesUsed);

    // Add externals from this file load using proper merging
    const mergedExternals = mergeExternals([allExternals, externals]);
    Object.assign(allExternals, mergedExternals);

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
          globalsFileKeys, // Pass through globals file tracking
        ).then((nestedResult) => ({
          files: nestedResult.extraFiles,
          allFilesUsed: nestedResult.allFilesUsed,
          allExternals: nestedResult.allExternals,
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
      allExternals: nestedExternals,
      sourceFileKey,
    } of nestedExtraFilesResults) {
      // Add nested files used
      allFilesUsed.push(...nestedFilesUsed);

      // Add nested externals using proper merging
      const mergedNestedExternals = mergeExternals([allExternals, nestedExternals]);
      Object.assign(allExternals, mergedNestedExternals);

      for (const [nestedKey, nestedValue] of Object.entries(nestedExtraFiles)) {
        // Convert the key based on the directory structure of the source key
        const convertedKey = convertKeyBasedOnDirectory(nestedKey, sourceFileKey);
        const normalizedConvertedKey = normalizePathKey(convertedKey);
        processedExtraFiles[normalizedConvertedKey] = nestedValue;
      }
    }
  }

  return { extraFiles: processedExtraFiles, allFilesUsed, allExternals };
}

/**
 * Loads a variant with support for recursive extra file loading.
 * The loadSource function can now return extraFiles that will be loaded recursively.
 * Supports both relative and absolute paths for extra files.
 * Uses Promise.all for efficient parallel loading of extra files.
 */
export async function loadCodeVariant(
  url: string | undefined,
  variantName: string,
  variant: VariantCode | string | undefined,
  options: LoadVariantOptions = {},
): Promise<{ code: VariantCode; dependencies: string[]; externals: Externals }> {
  if (!variant) {
    throw new Error(`Variant is missing from code: ${variantName}`);
  }

  const { sourceParser, loadSource, loadVariantMeta, sourceTransformers, globalsCode } = options;

  // Create a cache for loadSource calls scoped to this loadCodeVariant call
  const loadSourceCache = new Map<
    string,
    Promise<{
      source: VariantSource;
      extraFiles?: VariantExtraFiles;
      extraDependencies?: string[];
      externals?: Externals;
    }>
  >();

  const functionName = 'Load Variant';
  let currentMark = performanceMeasure(
    undefined,
    { mark: 'Start', measure: 'Start' },
    [functionName, url || variantName],
    true,
  );

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

      currentMark = performanceMeasure(
        currentMark,
        { mark: 'Loaded Variant Meta', measure: 'Variant Meta Loading' },
        [functionName, url || variantName],
      );
    }
  }

  const loadedFiles = new Set<string>();
  if (url) {
    loadedFiles.add(url);
  }
  const allFilesUsed: string[] = url ? [url] : []; // Start with the main file URL if available
  let allExternals: Externals = {}; // Collect externals from all sources

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
      externals: {}, // No externals without URL
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

  currentMark = performanceMeasure(
    currentMark,
    { mark: 'Loaded Main File', measure: 'Main File Loading' },
    [functionName, url || fileName],
    true,
  );

  // Validate extraFiles keys from variant definition
  if (variant.extraFiles) {
    for (const extraFileName of Object.keys(variant.extraFiles)) {
      // Check if key is an absolute URL (should be relative)
      if (isAbsolutePath(extraFileName)) {
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

  // Add externals from main file loading
  if (mainFileResult.externals) {
    allExternals = mergeExternals([allExternals, mainFileResult.externals]);
  }

  const externalsMergedMark = performanceMeasure(
    currentMark,
    { mark: 'Externals Merged', measure: 'Merging Externals' },
    [functionName, url || fileName],
  );
  currentMark = externalsMergedMark;

  // Track which files come from globals for metadata marking
  const globalsFileKeys = new Set<string>(); // Track globals file keys for loadExtraFiles

  // Process globalsCode array and add to extraFiles if provided
  if (globalsCode && globalsCode.length > 0) {
    // Collect existing filenames to avoid conflicts
    const existingFiles = new Set<string>();

    // Add main variant filename if it exists
    if (variant.fileName) {
      existingFiles.add(variant.fileName);
    }

    // Add already loaded extra files
    for (const key of Object.keys(extraFilesToLoad)) {
      existingFiles.add(key);
    }

    // Process all globals items in parallel
    const globalsPromises = globalsCode.map(async (globalsItem) => {
      let globalsVariant: VariantCode;

      if (typeof globalsItem === 'string') {
        // Handle string case - load the variant metadata
        if (!loadVariantMeta) {
          // Create a basic variant as fallback
          const { fileName: globalsFileName } = getFileNameFromUrl(globalsItem);
          if (!globalsFileName) {
            throw new Error(
              `Cannot determine fileName from globalsCode URL "${globalsItem}". ` +
                `Please provide a loadVariantMeta function or ensure the URL has a valid file extension.`,
            );
          }
          globalsVariant = {
            url: globalsItem,
            fileName: globalsFileName,
          };
        } else {
          try {
            globalsVariant = await loadVariantMeta(variantName, globalsItem);

            currentMark = performanceMeasure(
              currentMark,
              {
                mark: 'Globals Variant Meta Loaded',
                measure: 'Globals Variant Meta Loading',
              },
              [functionName, globalsItem, url || fileName],
            );
          } catch (error) {
            throw new Error(
              `Failed to load globalsCode variant metadata (variant: ${variantName}, url: ${globalsItem}): ${JSON.stringify(error)}`,
            );
          }
        }
      } else {
        globalsVariant = globalsItem;
      }

      // Load the globals code separately without affecting allFilesListed
      try {
        const globalsResult = await loadCodeVariant(
          globalsVariant.url,
          variantName,
          globalsVariant,
          { ...options, globalsCode: undefined }, // Prevent infinite recursion
        );

        currentMark = performanceMeasure(
          currentMark,
          { mark: 'Globals Variant Loaded', measure: 'Globals Variant Loading' },
          [functionName, globalsVariant.url || variantName, url || fileName],
        );

        return globalsResult;
      } catch (error) {
        throw new Error(
          `Failed to load globalsCode (variant: ${variantName}): ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        );
      }
    });

    // Wait for all globals to load
    const globalsResults = await Promise.all(globalsPromises);

    // Merge results from all globals
    for (const globalsResult of globalsResults) {
      // Add globals extraFiles (but NOT the main file)
      if (globalsResult.code.extraFiles) {
        // Add globals extra files with conflict-free naming and metadata flag
        for (const [key, value] of Object.entries(globalsResult.code.extraFiles)) {
          const conflictFreeKey = generateConflictFreeFilename(key, existingFiles);

          // Always add metadata: true flag for globals files
          if (typeof value === 'string') {
            // For string URLs, we can't easily wrap them but need to track for later metadata addition
            extraFilesToLoad[conflictFreeKey] = value;
            globalsFileKeys.add(conflictFreeKey); // Track for loadExtraFiles
          } else {
            // For object values, add metadata directly
            extraFilesToLoad[conflictFreeKey] = {
              ...value,
              metadata: true,
            };
          }
          existingFiles.add(conflictFreeKey); // Track the added file for subsequent iterations
        }
      }

      // Add globals dependencies
      allFilesUsed.push(...globalsResult.dependencies);

      // Add globals externals
      allExternals = mergeExternals([allExternals, globalsResult.externals]);
    }
  }

  currentMark = performanceMeasure(
    externalsMergedMark,
    { mark: 'Globals Loaded', measure: 'Globals Loading' },
    [functionName, url || fileName],
    true,
  );

  let allExtraFiles: VariantExtraFiles = {};

  // Load all extra files if any exist and we have a URL
  if (Object.keys(extraFilesToLoad).length > 0) {
    if (!url) {
      // If there's no URL, we can only load extra files that have inline source or absolute URLs
      const loadableFiles: VariantExtraFiles = {};
      for (const [key, value] of Object.entries(extraFilesToLoad)) {
        if (typeof value !== 'string' && value.source !== undefined) {
          // Inline source - can always load
          loadableFiles[key] = value;
        } else if (typeof value === 'string' && isAbsolutePath(value)) {
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
            // Inline source - preserve metadata if it was marked as globals
            const metadata = value.metadata || globalsFileKeys.has(key) ? true : undefined;
            allExtraFiles[normalizePathKey(key)] = {
              source: value.source!,
              transforms: value.transforms,
              ...(metadata !== undefined && { metadata }),
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
            globalsFileKeys, // Pass globals file tracking
          );
          allExtraFiles = { ...allExtraFiles, ...extraFilesResult.extraFiles };
          allFilesUsed.push(...extraFilesResult.allFilesUsed);
          allExternals = mergeExternals([allExternals, extraFilesResult.allExternals]);
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
        globalsFileKeys, // Pass globals file tracking
      );
      allExtraFiles = extraFilesResult.extraFiles;
      allFilesUsed.push(...extraFilesResult.allFilesUsed);
      allExternals = mergeExternals([allExternals, extraFilesResult.allExternals]);
    }

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Extra Files Loaded', measure: 'Extra Files Loading' },
      [functionName, url || fileName],
      true,
    );
  }

  // Note: metadata marking is now handled during loadExtraFiles processing

  const finalVariant: VariantCode = {
    ...variant,
    source: mainFileResult.source,
    transforms: mainFileResult.transforms,
    extraFiles: Object.keys(allExtraFiles).length > 0 ? allExtraFiles : undefined,
    externals: Object.keys(allExternals).length > 0 ? Object.keys(allExternals) : undefined,
  };

  return {
    code: finalVariant,
    dependencies: Array.from(new Set(allFilesUsed)), // Remove duplicates
    externals: allExternals,
  };
}

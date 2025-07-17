import { transformSource } from './transformSource';
import { transformParsedSource } from './transformParsedSource';
import type {
  VariantCode,
  VariantSource,
  VariantExtraFiles,
  Transforms,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  SourceTransformers,
  LoadFileOptions,
} from './types';

// Helper function to resolve relative paths using URL API
function resolveRelativePath(basePath: string, relativePath: string): string {
  if (!relativePath.startsWith('.')) {
    return relativePath;
  }

  try {
    // Use URL constructor to properly resolve relative paths
    const resolved = new URL(relativePath, basePath);
    return resolved.href;
  } catch (error) {
    // Fallback to manual resolution if URL constructor fails
    const baseSegments = basePath.split('/');
    const relativeSegments = relativePath.split('/');

    // Remove the filename from base path
    baseSegments.pop();

    for (const segment of relativeSegments) {
      if (segment === '..') {
        baseSegments.pop();
      } else if (segment !== '.') {
        baseSegments.push(segment);
      }
    }

    return baseSegments.join('/');
  }
}

// Helper function to convert a relative path from one base to another base
function convertRelativePathBetweenBases(
  relativePath: string,
  fromBaseUrl: string,
  toBaseUrl: string,
): string {
  if (!relativePath.startsWith('.')) {
    return relativePath; // Not a relative path, keep as-is
  }

  try {
    // Use URL constructor to resolve the relative path to absolute
    const absoluteUrl = new URL(relativePath, fromBaseUrl);

    // Now we need to make this absolute URL relative to toBaseUrl
    // We'll try to construct a relative path that, when resolved against toBaseUrl, gives us absoluteUrl

    // Get the directory of the target base
    const toBaseDir = new URL('.', toBaseUrl);

    // If both files are in the same directory, just return the filename
    const absoluteDir = new URL('.', absoluteUrl);
    if (absoluteDir.href === toBaseDir.href) {
      return absoluteUrl.pathname.split('/').pop() || '.';
    }

    // For different directories, we need to calculate the relative path manually
    // since there's no URL constructor method for absolute → relative conversion
    const toBaseParts = toBaseDir.pathname.split('/').filter(Boolean);
    const absoluteParts = absoluteUrl.pathname.split('/').filter(Boolean);

    // Find common prefix
    let commonLength = 0;
    while (
      commonLength < toBaseParts.length &&
      commonLength < absoluteParts.length &&
      toBaseParts[commonLength] === absoluteParts[commonLength]
    ) {
      commonLength += 1;
    }

    // Build relative path: '../' for remaining toBase parts, then absolute parts
    const upLevels = toBaseParts.length - commonLength;
    const relativeParts = Array(upLevels).fill('..').concat(absoluteParts.slice(commonLength));

    return relativeParts.length > 0 ? relativeParts.join('/') : '.';
  } catch (error) {
    return relativePath; // Fallback to original path
  }
}

async function loadSingleFile(
  variantName: string,
  fileName: string,
  source: VariantSource | undefined,
  url: string | undefined,
  loadSource: LoadSource | undefined,
  parseSource: ParseSource | undefined,
  sourceTransformers: SourceTransformers | undefined,
  transforms?: Transforms,
  options: LoadFileOptions = {},
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
      const loadResult = await loadSource(url);
      finalSource = loadResult.source;
      extraFilesFromSource = loadResult.extraFiles;
      extraDependenciesFromSource = loadResult.extraDependencies;
    } catch (error) {
      throw new Error(
        `Failed to load source code (variant: ${variantName}, file: ${fileName}, url: ${url}): ${JSON.stringify(error)}`,
      );
    }
  }

  // Apply source transformers if no transforms exist and transforms are not disabled
  let finalTransforms = transforms;
  if (sourceTransformers && !finalTransforms && !disableTransforms && finalSource) {
    finalTransforms = await transformSource(finalSource, fileName, sourceTransformers);
  }

  // Parse source if it's a string and parsing is not disabled
  if (typeof finalSource === 'string' && !disableParsing) {
    if (!parseSource) {
      // TODO: this needs to check shouldHighlight
      throw new Error(
        '"parseSource" function is required when source is a string and highlightAt is "init"',
      );
    }

    try {
      const sourceString = finalSource;
      finalSource = await parseSource(finalSource, fileName);

      if (finalTransforms && !disableTransforms) {
        finalTransforms = await transformParsedSource(
          sourceString,
          finalSource,
          fileName,
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
  parseSource: ParseSource | undefined,
  sourceTransformers: SourceTransformers | undefined,
  options: LoadFileOptions = {},
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
        // fileData is a URL/path
        fileUrl = fileData.startsWith('.') ? resolveRelativePath(baseUrl, fileData) : fileData;

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
        parseSource,
        sourceTransformers,
        transforms,
        { ...options, maxDepth: maxDepth - 1, loadedFiles: new Set(loadedFiles) },
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
    sourceFileUrl: string;
  }>[] = [];

  for (const { fileName, result, filesUsed } of extraFileResults) {
    processedExtraFiles[fileName] = {
      source: result.source,
      transforms: result.transforms,
    };

    // Add files used from this file load
    allFilesUsed.push(...filesUsed);

    // Collect promises for nested extra files with their source URL
    if (result.extraFiles) {
      let sourceFileUrl = baseUrl;
      const fileData = extraFiles[fileName];
      if (typeof fileData === 'string') {
        sourceFileUrl = fileData.startsWith('.')
          ? resolveRelativePath(baseUrl, fileData)
          : fileData;
      }

      nestedExtraFilesPromises.push(
        loadExtraFiles(
          variantName,
          result.extraFiles,
          sourceFileUrl, // Use the source file's URL as base for its extra files
          entryUrl, // Keep the entry URL for final conversion
          loadSource,
          parseSource,
          sourceTransformers,
          { ...options, maxDepth: maxDepth - 1, loadedFiles: new Set(loadedFiles) },
        ).then((nestedResult) => ({
          files: nestedResult.extraFiles,
          allFilesUsed: nestedResult.allFilesUsed,
          sourceFileUrl,
        })),
      );
    }
  }

  // Wait for all nested extra files and merge them, converting paths relative to entry
  if (nestedExtraFilesPromises.length > 0) {
    const nestedExtraFilesResults = await Promise.all(nestedExtraFilesPromises);
    for (const {
      files: nestedExtraFiles,
      allFilesUsed: nestedFilesUsed,
      sourceFileUrl,
    } of nestedExtraFilesResults) {
      // Add nested files used
      allFilesUsed.push(...nestedFilesUsed);

      for (const [nestedKey, nestedValue] of Object.entries(nestedExtraFiles)) {
        // Convert the key to be relative from entry file instead of from the source file
        const convertedKey = convertRelativePathBetweenBases(nestedKey, sourceFileUrl, entryUrl);
        processedExtraFiles[convertedKey] = nestedValue;
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
  url: string,
  variantName: string,
  variant: VariantCode | string | undefined,
  parseSource?: ParseSource,
  loadSource?: LoadSource,
  loadVariantCode?: LoadVariantCode,
  sourceTransformers?: SourceTransformers,
  options: LoadFileOptions = {},
): Promise<{ code: VariantCode; dependencies: string[] }> {
  if (!variant) {
    throw new Error(`Variant is missing from code: ${variantName}`);
  }

  if (typeof variant === 'string') {
    if (!loadVariantCode) {
      throw new Error('"loadVariantCode" function is required when loadCode returns strings');
      // TODO: maybe we can fall back to loadSource in this case?
    }

    try {
      variant = await loadVariantCode(variantName, variant);
    } catch (error) {
      throw new Error(
        `Failed to load variant code (variant: ${variantName}, url: ${variant}): ${JSON.stringify(error)}`,
      );
    }
  }

  const loadedFiles = new Set<string>();
  loadedFiles.add(url);
  const allFilesUsed = [url]; // Start with the main file URL

  // Load main file
  const mainFileResult = await loadSingleFile(
    variantName,
    variant.fileName,
    variant.source,
    url,
    loadSource,
    parseSource,
    sourceTransformers,
    variant.transforms,
    { ...options, loadedFiles },
  );

  // Add files used from main file loading
  if (mainFileResult.extraDependencies) {
    allFilesUsed.push(...mainFileResult.extraDependencies);
  }

  let allExtraFiles: VariantExtraFiles = {};

  // Collect extra files from variant definition and from loaded source
  const extraFilesToLoad: VariantExtraFiles = {
    ...(variant.extraFiles || {}),
    ...(mainFileResult.extraFiles || {}),
  };

  // Load all extra files if any exist
  if (Object.keys(extraFilesToLoad).length > 0) {
    const extraFilesResult = await loadExtraFiles(
      variantName,
      extraFilesToLoad,
      url,
      url, // Entry URL is the same as the main file URL
      loadSource,
      parseSource,
      sourceTransformers,
      { ...options, loadedFiles },
    );
    allExtraFiles = extraFilesResult.extraFiles;
    allFilesUsed.push(...extraFilesResult.allFilesUsed);
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

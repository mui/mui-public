/**
 * Add path utility to add path property to each file in a variant
 * Handles metadata prefix replacement and URL-based back navigation resolution
 */

import type { VariantCode, VariantSource, VariantExtraFiles } from './types';
import { getFileNameFromUrl } from '../pipeline/loaderUtils/getFileNameFromUrl';
import { createPathContext, type PathContext } from './examineVariant';
import { resolveRelativePath, countConsecutiveBackNavigation } from './pathUtils';

export interface FileWithPath {
  source?: VariantSource;
  metadata?: boolean;
  path: string;
}

export interface VariantWithPaths extends Omit<VariantCode, 'extraFiles'> {
  extraFiles?: Record<string, FileWithPath>;
  path?: string;
}

interface PathCalculationContext {
  variant: VariantCode;
  context: PathContext;
  fileName: string;
  hasNonMetadata: boolean;
  metadataInfo: ReturnType<typeof getMetadataInfo>;
  mainFilePath?: string;
}

type ExtraFileEntry = NonNullable<VariantExtraFiles>[string];

interface NormalizedFileObject {
  source?: VariantSource;
  metadata?: boolean;
}

/**
 * Add flat paths to all files in a variant
 */
export function addPathsToVariant(variant: VariantCode): VariantWithPaths {
  const context = createPathContext(variant);

  // Get effective fileName
  let effectiveFileName = variant.fileName;
  if (!effectiveFileName && context.hasUrl) {
    const { fileName } = getFileNameFromUrl(context.actualUrl);
    effectiveFileName = fileName;
  }

  // Calculate main file flat path
  let path: string | undefined;
  if (effectiveFileName) {
    path = calculateMainFilePath(variant, context, effectiveFileName);
  }

  // Handle extraFiles
  const extraFiles = calculateExtraFilesPaths(variant, context, path, effectiveFileName);

  return {
    ...variant,
    extraFiles,
    path,
  };
}

/**
 * Calculate paths for all extra files
 */
function calculateExtraFilesPaths(
  variant: VariantCode,
  context: PathContext,
  mainFilePath: string | undefined,
  effectiveFileName: string | undefined,
): Record<string, FileWithPath> | undefined {
  if (!variant.extraFiles) {
    // Special case: return {} instead of undefined for most cases, except when no fileName
    return effectiveFileName ? {} : undefined;
  }

  const extraFiles: Record<string, FileWithPath> = {};

  for (const [relativePath, fileContent] of Object.entries(variant.extraFiles)) {
    const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;
    const absolutePath = calculateExtraFilePath(relativePath, file, variant, context, mainFilePath);

    extraFiles[relativePath] = {
      ...file,
      path: absolutePath,
    };
  }

  return extraFiles;
}

/**
 * Build a path from multiple components, filtering out empty parts
 */
function buildPath(...segments: (string | string[] | undefined)[]): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment === undefined) {
      continue;
    }

    if (Array.isArray(segment)) {
      parts.push(...segment);
    } else {
      parts.push(segment);
    }
  }

  return parts.filter(Boolean).map(removeTrailingSlash).join('/');
}

function removeTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function countBackNavigationOccurrences(path: string): number {
  let count = 0;
  let index = 0;
  const pattern = '../';

  let foundIndex = path.indexOf(pattern, index);
  while (foundIndex !== -1) {
    count += 1;
    index = foundIndex + pattern.length;
    foundIndex = path.indexOf(pattern, index);
  }

  return count;
}

function removeLeadingBackNavigation(path: string): string {
  let result = path;
  while (result.startsWith('../')) {
    result = result.slice(3); // Remove '../'
  }
  return result;
}

function removeBackNavigationPrefix(path: string, count: number): string {
  let result = path;
  for (let i = 0; i < count; i += 1) {
    if (result.startsWith('../')) {
      result = result.slice(3);
    } else {
      break;
    }
  }
  return result;
}

function createSyntheticDirectories(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i));
}

function getUrlParts(url: string): string[] {
  return new URL(url).pathname.split('/').filter(Boolean);
}

function extractExtraDirectories(
  metadataEntries: Array<[string, ExtraFileEntry]>,
  expectedBackNav: number,
): string[] {
  const extraDirs: string[] = [];
  for (const [filePath] of metadataEntries) {
    const backNavCount = countBackNavigationOccurrences(filePath);
    if (backNavCount > expectedBackNav) {
      const remainingPath = removeLeadingBackNavigation(filePath);
      const pathParts = remainingPath.split('/');
      if (pathParts.length > 1) {
        const intermediateDirs = pathParts.slice(0, -1);
        extraDirs.push(...intermediateDirs);
      }
    }
  }
  return extraDirs;
}

function calculateEffectiveBackNavigation(
  maxBackNavigation: number,
  metadataInfo: ReturnType<typeof getMetadataInfo>,
  hasNonMetadata: boolean,
): number {
  let effectiveMaxBackNav = maxBackNavigation;
  if (metadataInfo.entries.length > 0 && hasNonMetadata) {
    for (const [relativePath, fileContent] of metadataInfo.entries) {
      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;
      if (file.metadata && relativePath.startsWith('..')) {
        const backCount = countBackNavigationOccurrences(relativePath);
        effectiveMaxBackNav = Math.max(effectiveMaxBackNav, backCount);
      }
    }
  }
  return effectiveMaxBackNav;
}
function hasNonMetadataFiles(variant: VariantCode): boolean {
  if (!variant.extraFiles) {
    return false;
  }
  return Object.values(variant.extraFiles).some((file) =>
    typeof file === 'object' ? !file.metadata : true,
  );
}

/**
 * Helper to get metadata entries and their back navigation info
 */
function getMetadataInfo(variant: VariantCode) {
  if (!variant.extraFiles) {
    return { entries: [], maxBackNav: 0, minBackNav: 0 };
  }

  const metadataEntries = Object.entries(variant.extraFiles).filter(
    ([, file]) => typeof file === 'object' && file.metadata,
  );

  if (metadataEntries.length === 0) {
    return { entries: metadataEntries, maxBackNav: 0, minBackNav: 0 };
  }

  const metadataBackNavs = metadataEntries.map(([filePath]) =>
    countBackNavigationOccurrences(filePath),
  );
  const maxBackNav = Math.max(...metadataBackNavs);
  const minBackNav = Math.min(...metadataBackNavs);

  return { entries: metadataEntries, maxBackNav, minBackNav };
}

/**
 * Calculate path for unbalanced metadata navigation case
 */
function calculateUnbalancedMetadataPath(
  variant: VariantCode,
  context: PathContext,
  fileName: string,
): string {
  if (!context.hasUrl) {
    return fileName;
  }

  if (!variant.metadataPrefix) {
    return fileName;
  }

  if (!variant.extraFiles) {
    return fileName;
  }

  const urlPath = new URL(context.actualUrl).pathname;
  const urlParts = urlPath.split('/').filter(Boolean);
  const metadataPrefixLevels = variant.metadataPrefix.split('/').filter(Boolean).length;

  // Create normalized extraFiles with trimmed metadata paths
  const normalizedExtraFiles: Record<string, NormalizedFileObject> = {};
  const expectedMetadataBackNav = context.maxBackNavigation + metadataPrefixLevels;

  for (const [filePath, file] of Object.entries(variant.extraFiles)) {
    const fileObj = typeof file === 'string' ? { source: file } : file;

    if (fileObj.metadata) {
      const consecutiveBackSteps = countConsecutiveBackNavigation(filePath);
      const trimCount = Math.min(consecutiveBackSteps, expectedMetadataBackNav);
      const trimmedPath = removeBackNavigationPrefix(filePath, trimCount);
      normalizedExtraFiles[trimmedPath] = { ...fileObj, metadata: false };
    } else {
      normalizedExtraFiles[filePath] = fileObj;
    }
  }

  // Calculate structure using normalized files
  const normalizedVariant = { ...variant, extraFiles: normalizedExtraFiles };
  const normalizedContext = createPathContext(normalizedVariant);

  // Build the synthetic URL structure
  const urlLevels = urlParts.length - 1;
  const syntheticDirsNeeded = Math.max(0, normalizedContext.maxBackNavigation - urlLevels);
  const syntheticDirs = Array.from({ length: syntheticDirsNeeded }, (_, i) =>
    String.fromCharCode(97 + i),
  );

  // Calculate directory allocation
  const pathForBackNav = context.maxBackNavigation + metadataPrefixLevels;
  const urlDirsForFile = urlParts.slice(0, -1);
  const remainingDirs = urlDirsForFile.slice(
    0,
    Math.max(0, urlDirsForFile.length - pathForBackNav),
  );
  const backNavDirs = urlDirsForFile.slice(-Math.min(pathForBackNav, urlDirsForFile.length));

  // Build path: synthetic + remaining URL + metadataPrefix + backNav + filename
  const pathParts = [
    ...syntheticDirs,
    ...remainingDirs,
    removeTrailingSlash(variant.metadataPrefix),
    ...backNavDirs,
    fileName,
  ].filter(Boolean);

  return pathParts.join('/');
}

/**
 * Calculate path for balanced extra back navigation case
 */
function calculateBalancedExtraBackNavPath(
  variant: VariantCode,
  context: PathContext,
  fileName: string,
  hasNonMetadata: boolean,
): string {
  if (!context.hasUrl) {
    return fileName;
  }

  if (!variant.metadataPrefix) {
    return fileName;
  }

  const urlPath = new URL(context.actualUrl).pathname;
  const urlParts = urlPath.split('/').filter(Boolean);

  if (hasNonMetadata) {
    const urlDirectories = urlParts.slice(0, -1);
    const urlDirsFromSecond = urlDirectories.slice(1);
    return [removeTrailingSlash(variant.metadataPrefix), ...urlDirsFromSecond, fileName].join('/');
  }

  return [removeTrailingSlash(variant.metadataPrefix), fileName].join('/');
}

/**
 * Calculate the main file path based on variant configuration
 */
function calculateMainFilePath(
  variant: VariantCode,
  context: PathContext,
  fileName: string,
): string {
  // Early return for simple case
  if (!variant.extraFiles || Object.keys(variant.extraFiles).length === 0) {
    return fileName;
  }

  const pathContext: PathCalculationContext = {
    variant,
    context,
    fileName,
    hasNonMetadata: hasNonMetadataFiles(variant),
    metadataInfo: getMetadataInfo(variant),
  };

  if (variant.metadataPrefix) {
    return calculatePathWithMetadataPrefix(pathContext);
  }

  return calculatePathWithoutMetadataPrefix(pathContext);
}

/**
 * Calculate path when metadataPrefix is present
 */
function calculatePathWithMetadataPrefix(pathContext: PathCalculationContext): string {
  const { variant, context, fileName, metadataInfo } = pathContext;

  if (!variant.metadataPrefix) {
    return fileName;
  }

  // No URL case - simple metadata prefix + fileName
  if (!context.hasUrl) {
    return buildPath(variant.metadataPrefix, fileName);
  }

  // Handle complex metadata cases first
  if (metadataInfo.entries.length > 0) {
    const complexResult = handleComplexMetadataCases(pathContext);
    if (complexResult) {
      return complexResult;
    }
  }

  // Fallback to regular metadataPrefix case
  return handleRegularMetadataPrefix(pathContext);
}

/**
 * Calculate path when no metadataPrefix is present
 */
function calculatePathWithoutMetadataPrefix(pathContext: PathCalculationContext): string {
  const { context, fileName } = pathContext;

  // No URL case - use synthetic directories if needed
  if (!context.hasUrl) {
    if (context.maxBackNavigation > 0) {
      const syntheticDirs = createSyntheticDirectories(context.maxBackNavigation);
      return buildPath(syntheticDirs, fileName);
    }
    return fileName;
  }

  // Handle URL-based path calculation
  return handleUrlBasedPath(pathContext);
}

/**
 * Handle complex metadata cases (unbalanced navigation, extra directories)
 */
function handleComplexMetadataCases(pathContext: PathCalculationContext): string | null {
  const { variant, context, fileName, hasNonMetadata, metadataInfo } = pathContext;

  if (!variant.metadataPrefix) {
    return null;
  }

  const metadataPrefixLevels = variant.metadataPrefix.split('/').filter(Boolean).length;
  const expectedBackNav = context.maxBackNavigation + metadataPrefixLevels;

  // Case 1: Unbalanced metadata navigation
  if (metadataInfo.minBackNav !== metadataInfo.maxBackNav) {
    return calculateUnbalancedMetadataPath(variant, context, fileName);
  }

  // Case 2: Extra back navigation with intermediate directories
  const extraDirs = extractExtraDirectories(metadataInfo.entries, expectedBackNav);
  if (extraDirs.length > 0 && hasNonMetadata) {
    return calculateBalancedExtraBackNavPath(variant, context, fileName, hasNonMetadata);
  }

  return null; // No complex case applies
}

/**
 * Handle regular metadata prefix cases
 */
function handleRegularMetadataPrefix(pathContext: PathCalculationContext): string {
  const { variant, context, fileName, hasNonMetadata } = pathContext;

  if (!variant.metadataPrefix) {
    return fileName;
  }

  if (!context.hasUrl) {
    return buildPath(variant.metadataPrefix, fileName);
  }

  const urlParts = getUrlParts(context.actualUrl);

  if (hasNonMetadata && context.maxBackNavigation > 0) {
    // Include URL directory when non-metadata files have back navigation
    const dirParts = urlParts.slice(-2, -1);
    return buildPath(variant.metadataPrefix, dirParts, fileName);
  }

  return buildPath(variant.metadataPrefix, fileName);
}

/**
 * Handle URL-based path calculation without metadata prefix
 */
function handleUrlBasedPath(pathContext: PathCalculationContext): string {
  const { variant, context, fileName, hasNonMetadata, metadataInfo } = pathContext;

  if (!context.hasUrl) {
    return fileName;
  }

  const urlParts = getUrlParts(context.actualUrl);

  // Special case: fileName derived from URL
  if (!variant.fileName) {
    return fileName.split('/').pop() || fileName;
  }

  // Calculate effective back navigation including metadata files
  const effectiveMaxBackNav = calculateEffectiveBackNavigation(
    context.maxBackNavigation,
    metadataInfo,
    hasNonMetadata,
  );

  // Metadata-only case
  if (metadataInfo.entries.length > 0 && !hasNonMetadata) {
    const dirParts = urlParts.slice(-2, -1);
    return buildPath(dirParts, fileName);
  }

  // Use effective back navigation
  if (effectiveMaxBackNav > 0) {
    const pathSegments = urlParts.slice(0, -1);
    const dirParts = pathSegments.slice(-effectiveMaxBackNav);
    return buildPath(dirParts, fileName);
  }

  return fileName;
}

/**
 * Calculate metadata file path
 */
function calculateMetadataFilePath(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  mainFilePath?: string,
): string {
  const { resolvedPath, backSteps } = resolveRelativePath(relativePath);

  // For unbalanced cases or complex scenarios, use main file path as reference
  if (mainFilePath && mainFilePath.includes('/')) {
    const mainPathParts = mainFilePath.split('/');
    const targetDirParts = mainPathParts.slice(0, -(backSteps + 1));

    if (targetDirParts.length > 0) {
      return [...targetDirParts, resolvedPath].join('/');
    }
    return resolvedPath;
  }

  return resolvedPath;
}

/**
 * Calculate back navigation file path
 */
function calculateBackNavigationFilePath(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  variant: VariantCode,
  context: PathContext,
  mainFilePath?: string,
): string {
  const { resolvedPath, backSteps } = resolveRelativePath(relativePath);

  // For non-metadata files with metadataPrefix, include the prefix
  if (variant.metadataPrefix) {
    if (mainFilePath && mainFilePath.includes('/')) {
      const mainPathParts = mainFilePath.split('/');
      const targetDirParts = mainPathParts.slice(0, -(backSteps + 1));
      return [...targetDirParts, resolvedPath].filter(Boolean).join('/');
    }

    return [removeTrailingSlash(variant.metadataPrefix), resolvedPath].filter(Boolean).join('/');
  }

  // Handle path resolution based on main file context
  if (mainFilePath && mainFilePath.includes('/')) {
    const mainPathParts = mainFilePath.split('/');
    const targetDirParts = mainPathParts.slice(0, -(backSteps + 1));
    return [...targetDirParts, resolvedPath].filter(Boolean).join('/');
  }

  // For cases without sufficient context, create synthetic structure
  if (context.maxBackNavigation > 0) {
    const syntheticDirs = Array.from({ length: context.maxBackNavigation }, (_, i) =>
      String.fromCharCode(97 + i),
    );
    const targetDirParts = syntheticDirs.slice(0, -backSteps);
    return [...targetDirParts, resolvedPath].filter(Boolean).join('/');
  }

  return resolvedPath;
}

/**
 * Calculate forward file path (no back navigation)
 */
function calculateForwardFilePath(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  variant: VariantCode,
  context: PathContext,
  mainFilePath?: string,
): string {
  const { resolvedPath } = resolveRelativePath(relativePath);

  // Handle non-metadata files without back navigation
  if (!file.metadata && variant.metadataPrefix) {
    // For non-metadata files with metadataPrefix, include URL directory
    if (mainFilePath && mainFilePath.includes('/')) {
      const mainPathParts = mainFilePath.split('/');
      const metadataPrefixParts = variant.metadataPrefix.split('/').filter(Boolean);

      // Find the metadataPrefix in the main path
      const metadataPrefixIndex = mainPathParts.findIndex(
        (part) => part === metadataPrefixParts[0],
      );
      if (metadataPrefixIndex > 0) {
        // Include extra directories before metadataPrefix
        const extraDirParts = mainPathParts.slice(0, metadataPrefixIndex);
        return [...extraDirParts, removeTrailingSlash(variant.metadataPrefix), resolvedPath].join(
          '/',
        );
      }
    }

    return [removeTrailingSlash(variant.metadataPrefix), resolvedPath].join('/');
  }

  // Handle non-metadata files with canceled-out path resolution
  if (
    relativePath.includes('../') &&
    mainFilePath &&
    mainFilePath.includes('/') &&
    context.hasUrl
  ) {
    const { backSteps } = resolveRelativePath(relativePath);
    if (backSteps === 0) {
      const mainPathParts = mainFilePath.split('/');
      const baseDirParts = mainPathParts.slice(0, -1);
      return [...baseDirParts, resolvedPath].join('/');
    }
  }

  return resolvedPath;
}

function calculateExtraFilePath(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  variant: VariantCode,
  context: PathContext,
  mainFilePath?: string,
): string {
  // Always resolve the relative path first to handle .. patterns properly
  const { backSteps } = resolveRelativePath(relativePath);

  // Handle metadata files
  if (file.metadata) {
    return calculateMetadataFilePath(relativePath, file, mainFilePath);
  }

  // Handle back navigation for non-metadata files
  if (backSteps > 0) {
    return calculateBackNavigationFilePath(relativePath, file, variant, context, mainFilePath);
  }

  // Handle forward paths (no back navigation)
  return calculateForwardFilePath(relativePath, file, variant, context, mainFilePath);
}

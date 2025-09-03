/**
 * Add path utility to add path property to each file in a variant
 * Handles metadata prefix replacement and URL-based back navigation resolution
 */

import type { VariantCode, VariantSource } from './types';
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

  // Handle extraFiles: return undefined if no extraFiles exist, {} if extraFiles exists
  let extraFiles: Record<string, FileWithPath> | undefined;

  if (variant.extraFiles) {
    extraFiles = {};

    for (const [relativePath, fileContent] of Object.entries(variant.extraFiles)) {
      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;

      const absolutePath = calculateExtraFilePath(relativePath, file, variant, context, path);

      extraFiles[relativePath] = {
        ...file,
        path: absolutePath,
      };
    }
  } else {
    // Special case: return {} instead of undefined for most cases, except when no fileName
    extraFiles = effectiveFileName ? {} : undefined;
  }

  return {
    ...variant,
    extraFiles,
    path,
  };
}

function calculateMainFilePath(
  variant: VariantCode,
  context: PathContext,
  fileName: string,
): string {
  // Special case: no extraFiles - just return fileName
  if (!variant.extraFiles || Object.keys(variant.extraFiles).length === 0) {
    return fileName;
  }

  // Check if we have non-metadata files (for determining if we need URL directories)
  const hasNonMetadataFiles = Object.values(variant.extraFiles).some((file) =>
    typeof file === 'object' ? !file.metadata : true,
  );

  // Case 1: Has metadataPrefix
  if (variant.metadataPrefix) {
    if (context.hasUrl) {
      const urlPath = new URL(context.actualUrl).pathname;
      const urlParts = urlPath.split('/').filter(Boolean);

      // Check for metadata files that need special handling
      const metadataEntries = Object.entries(variant.extraFiles).filter(
        ([, file]) => typeof file === 'object' && file.metadata,
      );

      if (metadataEntries.length > 0) {
        const metadataBackNavs = metadataEntries.map(
          ([filePath]) => (filePath.match(/\.\.\//g) || []).length,
        );
        const maxMetadataBackNav = Math.max(...metadataBackNavs);
        const minMetadataBackNav = Math.min(...metadataBackNavs);
        const metadataPrefixLevels = variant.metadataPrefix.split('/').filter(Boolean).length;
        const expectedBackNav = context.maxBackNavigation + metadataPrefixLevels;

        // Unbalanced metadata navigation
        if (minMetadataBackNav !== maxMetadataBackNav) {
          // Normalize metadata files by trimming expected back navigation
          // This allows examineVariant to calculate the synthetic structure naturally
          const expectedMetadataBackNav = context.maxBackNavigation + metadataPrefixLevels;

          // Create normalized extraFiles with trimmed metadata paths
          const normalizedExtraFiles: Record<string, any> = {};

          for (const [filePath, file] of Object.entries(variant.extraFiles!)) {
            const fileObj = typeof file === 'string' ? { source: file } : file;

            if (fileObj.metadata) {
              // Calculate consecutive back navigation at the start (for trimming)
              const consecutiveBackSteps = countConsecutiveBackNavigation(filePath);
              const trimCount = Math.min(consecutiveBackSteps, expectedMetadataBackNav);

              // Trim the expected back navigation using consecutive pattern matching
              const trimmedPath = filePath.replace(new RegExp(`^(\\.\\./){${trimCount}}`), '');
              normalizedExtraFiles[trimmedPath] = { ...fileObj, metadata: false }; // Treat as non-metadata for calculation
            } else {
              // Keep non-metadata files as-is
              normalizedExtraFiles[filePath] = fileObj;
            }
          }

          // Calculate structure using normalized files
          const normalizedVariant = { ...variant, extraFiles: normalizedExtraFiles };
          const normalizedContext = createPathContext(normalizedVariant);

          // Build the synthetic URL structure
          const urlLevels = urlParts.length - 1; // Exclude filename
          const syntheticDirsNeeded = Math.max(0, normalizedContext.maxBackNavigation - urlLevels);
          const syntheticDirs = Array.from({ length: syntheticDirsNeeded }, (_, i) =>
            String.fromCharCode(97 + i),
          );

          // Calculate directory allocation
          // Use metadata prefix to determine how much URL structure to preserve for back navigation
          const pathForBackNav = context.maxBackNavigation + metadataPrefixLevels; // Total structure needed
          const urlDirsForFile = urlParts.slice(0, -1); // All URL dirs
          const remainingDirs = urlDirsForFile.slice(
            0,
            Math.max(0, urlDirsForFile.length - pathForBackNav),
          );
          const backNavDirs = urlDirsForFile.slice(
            -Math.min(pathForBackNav, urlDirsForFile.length),
          );

          // Build path: synthetic + remaining URL + metadataPrefix + backNav + filename
          const pathParts = [
            ...syntheticDirs, // ['a', 'b']
            ...remainingDirs, // ['monorepo', 'lib']
            variant.metadataPrefix.replace(/\/$/, ''), // 'src/app'
            ...backNavDirs, // ['components', 'deep', 'nested']
            fileName, // 'Demo.tsx'
          ].filter(Boolean);

          return pathParts.join('/');
        }

        // Extract intermediate directories from metadata files with extra back navigation
        const extraDirs: string[] = [];
        for (const [filePath] of metadataEntries) {
          const backNavCount = (filePath.match(/\.\.\//g) || []).length;
          if (backNavCount > expectedBackNav) {
            const remainingPath = filePath.replace(/^(\.\.\/)+/, '');
            const pathParts = remainingPath.split('/');
            if (pathParts.length > 1) {
              const intermediateDirs = pathParts.slice(0, -1);
              extraDirs.push(...intermediateDirs);
            }
          }
        }

        // Use extracted directories if we have them and non-metadata files
        if (extraDirs.length > 0 && hasNonMetadataFiles) {
          // For balanced extra back navigation case: metadataPrefix + URL path (skip first dir, take rest)
          const urlDirectories = urlParts.slice(0, -1); // All directories from URL
          const urlDirsFromSecond = urlDirectories.slice(1); // Skip first directory, take rest from second to last
          return [variant.metadataPrefix.replace(/\/$/, ''), ...urlDirsFromSecond, fileName].join(
            '/',
          );
        }
      }

      // Regular metadataPrefix case
      if (hasNonMetadataFiles) {
        // Check if non-metadata files have back navigation
        if (context.maxBackNavigation > 0) {
          // Include URL directory when non-metadata files have back navigation
          const dirParts = urlParts.slice(-2, -1); // Parent directory
          return [variant.metadataPrefix.replace(/\/$/, ''), ...dirParts, fileName].join('/');
        }

        // Don't include URL directory when non-metadata files have no back navigation
        return [variant.metadataPrefix.replace(/\/$/, ''), fileName].join('/');
      }
    }

    // Metadata-only or no URL case
    return [variant.metadataPrefix.replace(/\/$/, ''), fileName].join('/');
  }

  // Case 2: No metadataPrefix but has URL
  if (context.hasUrl) {
    const urlPath = new URL(context.actualUrl).pathname;
    const urlParts = urlPath.split('/').filter(Boolean);

    // For files without fileName (synthetic from URL)
    if (!variant.fileName) {
      const pathParts = fileName.split('/');
      return pathParts[pathParts.length - 1];
    }

    // Check if we have metadata files and non-metadata files
    const hasMetadataFiles = Object.values(variant.extraFiles).some(
      (file) => typeof file === 'object' && file.metadata,
    );
    const hasNonMetadata = Object.values(variant.extraFiles).some((file) =>
      typeof file === 'object' ? !file.metadata : true,
    );

    // Calculate effective maxBackNavigation including metadata files when no metadataPrefix
    let effectiveMaxBackNav = context.maxBackNavigation;
    if (hasMetadataFiles && hasNonMetadata) {
      // For mixed cases without metadataPrefix, include metadata files in back navigation calculation
      for (const [relativePath, fileContent] of Object.entries(variant.extraFiles)) {
        const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;
        if (file.metadata && relativePath.startsWith('..')) {
          const backCount = (relativePath.match(/\.\.\//g) || []).length;
          effectiveMaxBackNav = Math.max(effectiveMaxBackNav, backCount);
        }
      }
    }

    // For cases with ONLY metadata files, extract just the immediate parent directory
    if (hasMetadataFiles && !hasNonMetadata) {
      const dirParts = urlParts.slice(-2, -1); // Get parent directory (e.g., "checkbox")
      return [...dirParts, fileName].join('/');
    }

    // For non-metadata cases or mixed cases, use exactly effectiveMaxBackNav number of path segments
    if (effectiveMaxBackNav > 0) {
      // Take exactly the last effectiveMaxBackNav segments from URL path (excluding filename)
      const pathSegments = urlParts.slice(0, -1); // Remove filename
      const dirParts = pathSegments.slice(-effectiveMaxBackNav);
      return [...dirParts, fileName].join('/');
    }

    return fileName;
  }

  // Case 3: No URL, use synthetic directories for back navigation
  if (context.maxBackNavigation > 0) {
    const syntheticDirs = Array.from({ length: context.maxBackNavigation }, (_, i) =>
      String.fromCharCode(97 + i),
    );
    return [...syntheticDirs, fileName].join('/');
  }

  return fileName;
}

function calculateExtraFilePath(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  variant: VariantCode,
  context: PathContext,
  path?: string,
): string {
  // Always resolve the relative path first to handle .. patterns properly
  const { resolvedPath, backSteps } = resolveRelativePath(relativePath);

  // Handle metadata files
  if (file.metadata) {
    // For unbalanced cases or complex scenarios, use main file path as reference
    if (path && path.includes('/')) {
      // Split main file path to understand the structure
      const mainPathParts = path.split('/');
      const targetDirParts = mainPathParts.slice(0, -(backSteps + 1)); // Go back from main file location

      if (targetDirParts.length > 0) {
        return [...targetDirParts, resolvedPath].join('/');
      }
      return resolvedPath;
    }
    // Simple case: just return resolved path
    return resolvedPath;
  }

  // Handle back navigation for non-metadata files
  if (backSteps > 0) {
    // For non-metadata files with metadataPrefix, include the prefix
    if (variant.metadataPrefix) {
      // If main file path has extra directories, use main file as reference
      if (path && path.includes('/')) {
        const mainPathParts = path.split('/');
        const targetDirParts = mainPathParts.slice(0, -(backSteps + 1));
        return [...targetDirParts, resolvedPath].filter(Boolean).join('/');
      }

      return [variant.metadataPrefix.replace(/\/$/, ''), resolvedPath].filter(Boolean).join('/');
    }

    // Handle path resolution based on main file context
    if (path && path.includes('/')) {
      const mainPathParts = path.split('/');
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

  // Handle non-metadata files without back navigation
  if (!file.metadata && variant.metadataPrefix) {
    // For non-metadata files with metadataPrefix, include URL directory
    if (path && path.includes('/')) {
      const mainPathParts = path.split('/');
      const metadataPrefixParts = variant.metadataPrefix.split('/').filter(Boolean);

      // Find the metadataPrefix in the main path
      const metadataPrefixIndex = mainPathParts.findIndex(
        (part) => part === metadataPrefixParts[0],
      );
      if (metadataPrefixIndex > 0) {
        // Include extra directories before metadataPrefix
        const extraDirParts = mainPathParts.slice(0, metadataPrefixIndex);
        return [...extraDirParts, variant.metadataPrefix.replace(/\/$/, ''), resolvedPath].join(
          '/',
        );
      }
    }

    return [variant.metadataPrefix.replace(/\/$/, ''), resolvedPath].join('/');
  }

  // Handle non-metadata files with canceled-out path resolution
  // If the original path had .. patterns that were canceled by forward dirs, inherit base path
  // Only applies when there's a real URL structure (not synthetic)
  if (
    relativePath.includes('../') &&
    backSteps === 0 &&
    path &&
    path.includes('/') &&
    context.hasUrl
  ) {
    const mainPathParts = path.split('/');
    const baseDirParts = mainPathParts.slice(0, -1); // All directories except filename
    return [...baseDirParts, resolvedPath].join('/');
  }

  return resolvedPath;
}
